import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ErrorResponse,
  HistoricalAverage,
  HistoricalBucket,
  ParkData,
  ParkError,
  ParkSlug,
  PARK_ORDER,
  Ride,
} from './types';
import { fetchLiveData, UpstreamError } from './themeparksClient';
import { filterToRides } from './rideFilter';
import { resolveLand } from './landResolver';
import { TTLCache } from './cache';
import { shapeCombined, shapeParkData, shapeParkError } from './responseShape';
import { classifyDayType } from './dayType';
import { bucketsAroundNow } from './bucketing';
import {
  bucketEntry,
  ensureLoaded,
  lookupAverage,
} from './historicalAverages';
import { ensureRideStatsLoaded, lookupRideStats } from './rideStats';

const CACHE_TTL_MS = 150_000;
const parkCache = new TTLCache<ParkSlug, ParkData>(CACHE_TTL_MS);

async function buildHistoricalAverage(
  parkSlug: ParkSlug,
  rideId: string,
  now: Date
): Promise<HistoricalAverage | null> {
  // historical_averages reads can fail (Firestore down, bad credentials).
  // We swallow here so a missing averages dataset doesn't take down the
  // entire /v0/waits response — the rider still gets live data; the
  // ride simply renders without the historical comparison.
  let averages;
  try {
    averages = await ensureLoaded();
  } catch (err) {
    console.warn('historical_averages load failed; serving without averages', err);
    return null;
  }

  const dayType = classifyDayType(now);
  const [b0, b30, b60] = bucketsAroundNow(now);
  const v0 = lookupAverage(averages, parkSlug, rideId, b0, dayType);
  const v30 = lookupAverage(averages, parkSlug, rideId, b30, dayType);
  const v60 = lookupAverage(averages, parkSlug, rideId, b60, dayType);

  // Spec: historicalAverage is null when no average exists for the ride's
  // CURRENT bucket on the current day type. (We still return the t+30/+60
  // entries inside the buckets array even if individually missing.)
  if (v0 === null) return null;

  const buckets: [HistoricalBucket, HistoricalBucket, HistoricalBucket] = [
    bucketEntry(0, b0, v0),
    bucketEntry(30, b30, v30),
    bucketEntry(60, b60, v60),
  ];
  return { dayType, buckets };
}

async function buildRideStats(
  parkSlug: ParkSlug,
  rideId: string,
  dayType: ReturnType<typeof classifyDayType>
): Promise<import('./types').RideStats | null> {
  let statsMap;
  try {
    statsMap = await ensureRideStatsLoaded();
  } catch (err) {
    console.warn('ride_stats load failed; serving without ride stats', err);
    return null;
  }
  return lookupRideStats(statsMap, parkSlug, rideId, dayType);
}

async function fetchPark(parkSlug: ParkSlug, referenceDate?: Date): Promise<ParkData> {
  // Skip cache for time-travel requests so historical data isn't served stale.
  if (!referenceDate) {
    const cached = parkCache.get(parkSlug);
    if (cached) return cached;
  }

  const live = await fetchLiveData(parkSlug);
  const now = referenceDate ?? new Date();
  const dayType = classifyDayType(now);

  const rides: Ride[] = await Promise.all(
    filterToRides(live.liveData).map(async entity => {
      const isOperating = entity.status === 'OPERATING';
      const [historicalAverage, rideStats] = isOperating
        ? await Promise.all([
            buildHistoricalAverage(parkSlug, entity.id, now),
            buildRideStats(parkSlug, entity.id, dayType),
          ])
        : [null, null];
      return {
        id: entity.id,
        name: entity.name,
        land: resolveLand(entity.id, parkSlug),
        status: entity.status ?? 'UNKNOWN',
        currentWait: isOperating ? entity.queue?.STANDBY?.waitTime ?? null : null,
        historicalAverage,
        rideStats,
        prediction: null,
      };
    })
  );

  const data = shapeParkData(parkSlug, rides, now.toISOString());
  if (!referenceDate) parkCache.set(parkSlug, data);
  return data;
}

function corsHeaders(): Record<string, string> {
  const origin = process.env.CORS_ORIGIN ?? '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'x-api-key, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

function jsonResponse(
  statusCode: number,
  body: object
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

function errorBody(error: string, message: string): ErrorResponse {
  return { error, message, lastUpdated: null };
}

function isValidApiKey(event: APIGatewayProxyEvent): boolean {
  const expected = process.env.API_KEY;
  if (!expected) return false;
  const headers = event.headers ?? {};
  const provided = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
  return provided === expected;
}

type RouteKind =
  | { kind: 'combined' }
  | { kind: 'park'; slug: ParkSlug }
  | { kind: 'unknown' };

function routeFromPath(path: string | null | undefined): RouteKind {
  if (!path) return { kind: 'unknown' };
  if (path.endsWith('/v0/waits/disneyland')) {
    return { kind: 'park', slug: 'disneyland' };
  }
  if (path.endsWith('/v0/waits/california-adventure')) {
    return { kind: 'park', slug: 'california-adventure' };
  }
  if (path.endsWith('/v0/waits')) return { kind: 'combined' };
  return { kind: 'unknown' };
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (!isValidApiKey(event)) {
    return jsonResponse(
      401,
      errorBody('UNAUTHORIZED', 'Missing or invalid API key')
    );
  }

  const route = routeFromPath(event.path);

  if (route.kind === 'unknown') {
    return jsonResponse(
      404,
      errorBody('NOT_FOUND', `Unknown path: ${event.path}`)
    );
  }

  const atParam = event.queryStringParameters?.at;
  let referenceDate: Date | undefined;
  if (atParam) {
    referenceDate = new Date(atParam);
    if (isNaN(referenceDate.getTime())) {
      return jsonResponse(400, errorBody('BAD_REQUEST', 'Invalid ?at= parameter — must be a valid ISO 8601 date string'));
    }
  }

  if (route.kind === 'park') {
    try {
      const data = await fetchPark(route.slug, referenceDate);
      return jsonResponse(200, data);
    } catch (err) {
      const status = err instanceof UpstreamError ? err.statusCode : 502;
      const message = err instanceof Error ? err.message : 'Unknown upstream error';
      return jsonResponse(status, errorBody('UPSTREAM_UNAVAILABLE', message));
    }
  }

  // combined endpoint — best-effort, parks fetched in parallel
  const entries: (ParkData | ParkError)[] = await Promise.all(
    PARK_ORDER.map(async (slug): Promise<ParkData | ParkError> => {
      try {
        return await fetchPark(slug, referenceDate);
      } catch {
        return shapeParkError(slug, 'UPSTREAM_UNAVAILABLE');
      }
    })
  );

  const allErrored = entries.every(e => 'error' in e);
  if (allErrored) {
    return jsonResponse(
      502,
      errorBody('UPSTREAM_UNAVAILABLE', 'All upstream park fetches failed')
    );
  }

  return jsonResponse(200, shapeCombined(entries));
}

// Test helper — clears the module-level cache between tests.
export function _resetCacheForTests(): void {
  parkCache.clear();
}
