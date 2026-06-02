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
import { ensureRideMetadataLoaded, lookupRideMetadata } from './recommendations/rideMetadata';
import { loadCurrentClosures, lookupClosedAt } from './currentClosures';
import { loadDeviceNotifications } from './notificationLog';
import { fetchRecentHistory } from './recentHistory';
import { scoreRide } from './scoring/score';
import { buildRecommendations } from './recommendations/handler';
import { personaCacheKey } from './recommendations/persona';
import {
  AccessibilityNeed,
  Persona,
  RecommendationsResponse,
  RideCategory,
  TripDuration,
} from './types';
import {
  DAILY_PARKS_VALUES,
  DailyParks,
  NOTIFICATION_KINDS,
  NotificationTypes,
  PUSH_TOKEN_TYPES,
  PushTokenType,
  setArmedDate,
  setDailyParks,
  setMustDoRideIds,
  setNotificationTypes,
  todayInPT,
  upsertDevice,
} from './devices/devices';

const CACHE_TTL_MS = 150_000;
const parkCache = new TTLCache<ParkSlug, ParkData>(CACHE_TTL_MS);

// Recommendations cache: same response for the same (park, currentRideId)
// within a 5-minute window. Catches rapid re-taps and back-button navigation
// without re-hitting Bedrock.
const RECS_TTL_MS = 300_000;
const recsCache = new TTLCache<string, RecommendationsResponse>(RECS_TTL_MS);

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
  const [b0, b30, b60, b90, b120] = bucketsAroundNow(now);
  const v0   = lookupAverage(averages, parkSlug, rideId, b0,   dayType);
  const v30  = lookupAverage(averages, parkSlug, rideId, b30,  dayType);
  const v60  = lookupAverage(averages, parkSlug, rideId, b60,  dayType);
  const v90  = lookupAverage(averages, parkSlug, rideId, b90,  dayType);
  const v120 = lookupAverage(averages, parkSlug, rideId, b120, dayType);

  // Spec: historicalAverage is null when no average exists for the ride's
  // CURRENT bucket on the current day type. (We still return the t+30…t+120
  // entries inside the buckets array even if individually missing.)
  if (v0 === null) return null;

  const buckets: [HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket] = [
    bucketEntry(0,   b0,   v0),
    bucketEntry(30,  b30,  v30),
    bucketEntry(60,  b60,  v60),
    bucketEntry(90,  b90,  v90),
    bucketEntry(120, b120, v120),
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

export async function fetchPark(parkSlug: ParkSlug, referenceDate?: Date): Promise<ParkData> {
  // Skip cache for time-travel requests so historical data isn't served stale.
  if (!referenceDate) {
    const cached = parkCache.get(parkSlug);
    if (cached) return cached;
  }

  const now = referenceDate ?? new Date();
  const dayType = classifyDayType(now);
  const [live, recentHistoryMap, metadataMap, closuresMap] = await Promise.all([
    fetchLiveData(parkSlug),
    fetchRecentHistory(parkSlug, now),
    ensureRideMetadataLoaded().catch(() => new Map()),
    // Best-effort: a missing/failed current_closures fetch just means no
    // closedAt timestamps, never a 5xx for the whole response.
    loadCurrentClosures().catch(() => new Map()),
  ]);

  const allRides: Ride[] = await Promise.all(
    filterToRides(live.liveData).map(async entity => {
      const isOperating = entity.status === 'OPERATING';
      // rideStats is looked up for all rides (not just operating) so the
      // non-ride filter below can use it to drop chronic walk-ons /
      // walkthroughs / experiences regardless of current status.
      const [historicalAverage, rideStats] = await Promise.all([
        isOperating ? buildHistoricalAverage(parkSlug, entity.id, now) : Promise.resolve(null),
        buildRideStats(parkSlug, entity.id, dayType),
      ]);
      const meta = lookupRideMetadata(metadataMap, entity.id);
      const status = entity.status ?? 'UNKNOWN';
      const ride: Ride = {
        id: entity.id,
        name: entity.name,
        land: resolveLand(entity.id, parkSlug),
        status,
        currentWait: isOperating ? entity.queue?.STANDBY?.waitTime ?? null : null,
        historicalAverage,
        rideStats,
        prediction: null,
        recentHistory: recentHistoryMap.get(entity.id) ?? null,
        lat: meta?.lat ?? null,
        lng: meta?.lng ?? null,
        // Only meaningful when status is DOWN — the scanner only records
        // OPERATING → DOWN transitions. For other states we leave null.
        closedAt: status === 'DOWN' ? lookupClosedAt(closuresMap, entity.id) : null,
      };
      ride.score = scoreRide(ride);
      return ride;
    })
  );

  // Filter out chronic walk-ons / walkthroughs / non-ride experiences:
  // rides whose p90 has stayed below 5 min across many observations are
  // never going to produce a meaningful wait. Closed-but-real rides
  // (refurbishment, scheduled closures) pass because their stats are
  // populated. Rides with <= 100 samples pass too — we err on showing.
  const rides = allRides.filter(r => {
    if (!r.rideStats) return true;
    if (r.rideStats.sampleCount <= 100) return true;
    return r.rideStats.p90 >= 5;
  });

  const data = shapeParkData(parkSlug, rides, now.toISOString());
  if (!referenceDate) parkCache.set(parkSlug, data);
  return data;
}

function corsHeaders(): Record<string, string> {
  const origin = process.env.CORS_ORIGIN ?? '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'x-api-key, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  | { kind: 'recommendations' }
  | { kind: 'device-register' }
  | { kind: 'device-arm'; deviceId: string }
  | { kind: 'device-must-do'; deviceId: string }
  | { kind: 'device-daily-parks'; deviceId: string }
  | { kind: 'device-notification-types'; deviceId: string }
  | { kind: 'device-notifications-list'; deviceId: string }
  | { kind: 'unknown' };

function routeFromPath(
  path: string | null | undefined,
  method: string | null | undefined
): RouteKind {
  if (!path) return { kind: 'unknown' };
  if (path.endsWith('/v2/recommendations') && method === 'POST') {
    return { kind: 'recommendations' };
  }
  if (method === 'POST') {
    if (path.endsWith('/v1/devices')) {
      return { kind: 'device-register' };
    }
    const armMatch = path.match(/\/v1\/devices\/([^/]+)\/arm$/);
    if (armMatch) return { kind: 'device-arm', deviceId: armMatch[1] };
    const mustDoMatch = path.match(/\/v1\/devices\/([^/]+)\/must-do$/);
    if (mustDoMatch) return { kind: 'device-must-do', deviceId: mustDoMatch[1] };
    const dailyParksMatch = path.match(/\/v1\/devices\/([^/]+)\/daily-parks$/);
    if (dailyParksMatch) return { kind: 'device-daily-parks', deviceId: dailyParksMatch[1] };
    const notifTypesMatch = path.match(/\/v1\/devices\/([^/]+)\/notification-types$/);
    if (notifTypesMatch) return { kind: 'device-notification-types', deviceId: notifTypesMatch[1] };
  }
  if (method === 'GET') {
    const notifListMatch = path.match(/\/v1\/devices\/([^/]+)\/notifications$/);
    if (notifListMatch) return { kind: 'device-notifications-list', deviceId: notifListMatch[1] };
  }
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

  const route = routeFromPath(event.path, event.httpMethod);

  if (route.kind === 'unknown') {
    return jsonResponse(
      404,
      errorBody('NOT_FOUND', `Unknown path: ${event.path}`)
    );
  }

  if (route.kind === 'recommendations') {
    return handleRecommendations(event);
  }

  if (route.kind === 'device-register') {
    return handleDeviceRegister(event);
  }

  if (route.kind === 'device-arm') {
    return handleDeviceArm(route.deviceId);
  }

  if (route.kind === 'device-must-do') {
    return handleDeviceMustDo(route.deviceId, event);
  }

  if (route.kind === 'device-daily-parks') {
    return handleDeviceDailyParks(route.deviceId, event);
  }

  if (route.kind === 'device-notification-types') {
    return handleDeviceNotificationTypes(route.deviceId, event);
  }

  if (route.kind === 'device-notifications-list') {
    return handleDeviceNotificationsList(route.deviceId);
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

async function handleRecommendations(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  let body: {
    park?: unknown;
    userLat?: unknown;
    userLng?: unknown;
    persona?: unknown;
    excludeRideIds?: unknown;
  };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'Body must be JSON'));
  }

  const park = body.park;
  const userLat = body.userLat;
  const userLng = body.userLng;
  if (park !== 'disneyland' && park !== 'california-adventure') {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'park must be "disneyland" or "california-adventure"'));
  }
  if (typeof userLat !== 'number' || !Number.isFinite(userLat)) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'userLat must be a finite number'));
  }
  if (typeof userLng !== 'number' || !Number.isFinite(userLng)) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'userLng must be a finite number'));
  }

  // Optional persona — bad shapes are dropped silently (logged, not 400'd) so
  // a client-side schema drift never bricks the recommendations endpoint.
  const persona = parsePersona(body.persona);

  // Optional excludeRideIds — used by the "show more" flow so the next
  // batch doesn't repeat what's already on screen. Invalid shapes drop to
  // an empty list rather than 400.
  const excludeRideIds = Array.isArray(body.excludeRideIds)
    ? body.excludeRideIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];

  // Optional ?at=<iso> for time-travel testing — same param as /v0/waits.
  // When set we bypass the recs cache to avoid mixing live/time-travel results.
  const atParam = event.queryStringParameters?.at;
  let at: Date | undefined;
  if (atParam) {
    at = new Date(atParam);
    if (isNaN(at.getTime())) {
      return jsonResponse(400, errorBody('BAD_REQUEST', 'Invalid ?at= parameter'));
    }
  }

  // Cache key: coarse GPS grid (4 decimal places ≈ 11 m precision) +
  // persona + excludeRideIds so different users/batches don't collide.
  const excludeKey =
    excludeRideIds.length === 0 ? '' : '__ex' + [...excludeRideIds].sort().join(',');
  const cacheKey = `${park}__${userLat.toFixed(4)}_${userLng.toFixed(4)}__${personaCacheKey(persona)}${excludeKey}`;
  if (!at) {
    const cached = recsCache.get(cacheKey);
    if (cached) {
      return jsonResponse(200, cached);
    }
  }

  try {
    const result = await buildRecommendations({ park, userLat, userLng, at, persona, excludeRideIds });
    if (!at) recsCache.set(cacheKey, result);
    return jsonResponse(200, result);
  } catch (err) {
    const status = err instanceof UpstreamError ? err.statusCode : 502;
    const message = err instanceof Error ? err.message : 'Unknown upstream error';
    return jsonResponse(status, errorBody('UPSTREAM_UNAVAILABLE', message));
  }
}

const TRIP_DURATIONS: readonly TripDuration[] = ['1-day', '2-days', '3-4-days', '5-plus-days'];
const RIDE_CATEGORIES: readonly RideCategory[] = [
  'thrills', 'classics', 'immersive', 'kid-favorites', 'shows-characters', 'first-time',
];
const ACCESSIBILITY_NEEDS: readonly AccessibilityNeed[] = [
  'stroller', 'wheelchair', 'pregnant', 'sensory', 'none',
];

function parsePersona(raw: unknown): Persona | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') {
    console.warn('persona: not an object; ignoring');
    return null;
  }
  const r = raw as Record<string, unknown>;

  const tripDuration =
    typeof r.tripDuration === 'string' && (TRIP_DURATIONS as readonly string[]).includes(r.tripDuration)
      ? (r.tripDuration as TripDuration)
      : null;

  let youngestAge: number | null = null;
  if (typeof r.youngestAge === 'number' && Number.isFinite(r.youngestAge)) {
    const clamped = Math.max(0, Math.min(18, Math.round(r.youngestAge)));
    youngestAge = clamped;
  }

  const ridePreferences: RideCategory[] = Array.isArray(r.ridePreferences)
    ? r.ridePreferences.filter(
        (x): x is RideCategory =>
          typeof x === 'string' && (RIDE_CATEGORIES as readonly string[]).includes(x)
      )
    : [];

  const mustDoRideIds: string[] = Array.isArray(r.mustDoRideIds)
    ? r.mustDoRideIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];

  const accessibilityNeeds: AccessibilityNeed[] = Array.isArray(r.accessibilityNeeds)
    ? r.accessibilityNeeds.filter(
        (x): x is AccessibilityNeed =>
          typeof x === 'string' && (ACCESSIBILITY_NEEDS as readonly string[]).includes(x)
      )
    : [];

  return { tripDuration, youngestAge, ridePreferences, mustDoRideIds, accessibilityNeeds };
}

// --- /v1/devices/* handlers ---

async function handleDeviceRegister(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  let body: {
    deviceId?: unknown;
    pushToken?: unknown;
    pushTokenType?: unknown;
    mustDoRideIds?: unknown;
    notificationsEnabled?: unknown;
  };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'Body must be JSON'));
  }

  const deviceId = body.deviceId;
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'deviceId must be a non-empty string'));
  }

  const pushToken =
    body.pushToken === null || body.pushToken === undefined
      ? null
      : typeof body.pushToken === 'string'
      ? body.pushToken
      : undefined;
  if (pushToken === undefined) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'pushToken must be a string or null'));
  }

  let pushTokenType: PushTokenType | null = null;
  if (body.pushTokenType !== null && body.pushTokenType !== undefined) {
    if (typeof body.pushTokenType !== 'string' || !(PUSH_TOKEN_TYPES as readonly string[]).includes(body.pushTokenType)) {
      return jsonResponse(400, errorBody('BAD_REQUEST', 'pushTokenType must be "web" or "expo"'));
    }
    pushTokenType = body.pushTokenType as PushTokenType;
  }

  const mustDoRideIds = Array.isArray(body.mustDoRideIds)
    ? body.mustDoRideIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : undefined;

  const notificationsEnabled =
    typeof body.notificationsEnabled === 'boolean' ? body.notificationsEnabled : undefined;

  try {
    await upsertDevice(deviceId, {
      pushToken,
      pushTokenType,
      mustDoRideIds,
      notificationsEnabled,
    });
    return jsonResponse(200, { deviceId, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse(500, errorBody('INTERNAL_ERROR', message));
  }
}

async function handleDeviceArm(deviceId: string): Promise<APIGatewayProxyResult> {
  if (!deviceId) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'deviceId missing from path'));
  }
  const armedDate = todayInPT();
  try {
    await setArmedDate(deviceId, armedDate);
    return jsonResponse(200, { deviceId, armedDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse(500, errorBody('INTERNAL_ERROR', message));
  }
}

async function handleDeviceMustDo(
  deviceId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (!deviceId) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'deviceId missing from path'));
  }
  let body: { mustDoRideIds?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'Body must be JSON'));
  }
  if (!Array.isArray(body.mustDoRideIds)) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'mustDoRideIds must be an array of strings'));
  }
  const rideIds = body.mustDoRideIds.filter(
    (x): x is string => typeof x === 'string' && x.length > 0
  );
  try {
    await setMustDoRideIds(deviceId, rideIds);
    return jsonResponse(200, { deviceId, mustDoRideIds: rideIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse(500, errorBody('INTERNAL_ERROR', message));
  }
}

async function handleDeviceNotificationsList(
  deviceId: string
): Promise<APIGatewayProxyResult> {
  if (!deviceId) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'deviceId missing from path'));
  }
  try {
    const notifications = await loadDeviceNotifications(deviceId);
    return jsonResponse(200, { deviceId, notifications });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse(500, errorBody('INTERNAL_ERROR', message));
  }
}

async function handleDeviceNotificationTypes(
  deviceId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (!deviceId) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'deviceId missing from path'));
  }
  let body: { trough?: unknown; closure?: unknown; reopen?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'Body must be JSON'));
  }
  const types: Partial<NotificationTypes> = {};
  for (const kind of NOTIFICATION_KINDS) {
    const val = body[kind];
    if (typeof val !== 'boolean') {
      return jsonResponse(400, errorBody('BAD_REQUEST', `${kind} must be a boolean`));
    }
    types[kind] = val;
  }
  try {
    await setNotificationTypes(deviceId, types as NotificationTypes);
    return jsonResponse(200, { deviceId, notificationTypes: types });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse(500, errorBody('INTERNAL_ERROR', message));
  }
}

async function handleDeviceDailyParks(
  deviceId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (!deviceId) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'deviceId missing from path'));
  }
  let body: { dailyParks?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'Body must be JSON'));
  }
  if (
    typeof body.dailyParks !== 'string' ||
    !(DAILY_PARKS_VALUES as readonly string[]).includes(body.dailyParks)
  ) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'dailyParks must be "disneyland", "california-adventure", or "both"'));
  }
  try {
    await setDailyParks(deviceId, body.dailyParks as DailyParks);
    return jsonResponse(200, { deviceId, dailyParks: body.dailyParks });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse(500, errorBody('INTERNAL_ERROR', message));
  }
}

// Test helper — clears the module-level caches between tests.
export function _resetCacheForTests(): void {
  parkCache.clear();
  recsCache.clear();
}
