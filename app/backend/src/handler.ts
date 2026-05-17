import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ErrorResponse,
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

const CACHE_TTL_MS = 150_000;
const parkCache = new TTLCache<ParkSlug, ParkData>(CACHE_TTL_MS);

async function fetchPark(parkSlug: ParkSlug): Promise<ParkData> {
  const cached = parkCache.get(parkSlug);
  if (cached) return cached;

  const live = await fetchLiveData(parkSlug);

  const rides: Ride[] = filterToRides(live.liveData).map(entity => ({
    id: entity.id,
    name: entity.name,
    land: resolveLand(entity.id, parkSlug),
    status: entity.status ?? 'UNKNOWN',
    currentWait:
      entity.status === 'OPERATING'
        ? entity.queue?.STANDBY?.waitTime ?? null
        : null,
  }));

  const data = shapeParkData(parkSlug, rides, new Date().toISOString());
  parkCache.set(parkSlug, data);
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

  if (route.kind === 'park') {
    try {
      const data = await fetchPark(route.slug);
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
        return await fetchPark(slug);
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
