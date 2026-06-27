import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ErrorResponse,
  FullDaySlot,
  HistoricalAverage,
  HistoricalBucket,
  ParkData,
  ParkError,
  ParkSlug,
  PARK_ORDER,
  Prediction,
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
import { loadPredictions, MLPredictionDoc } from './mlPredictions';
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
  UserResponse,
} from './types';
import { upsertUser, getUser, getTrip, deleteUserData, claimFreeTrip, validatePromoCode } from './users';
import { purchaseTrip } from './tripPurchase';
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

interface HistoricalAverageResult {
  primary: HistoricalAverage | null;
  baseline: HistoricalAverage | null; // pure historical; non-null only when ML is also active
}

async function buildHistoricalAverage(
  parkSlug: ParkSlug,
  rideId: string,
  now: Date,
  currentWait: number | null,
  mlPred?: MLPredictionDoc,
): Promise<HistoricalAverageResult> {
  const dayType = classifyDayType(now);
  const [b0, b30, b60, b90, b120, b150] = bucketsAroundNow(now);

  let averages;
  try {
    averages = await ensureLoaded();
  } catch (err) {
    console.warn('historical_averages load failed; serving without averages', err);
    return { primary: null, baseline: null };
  }

  const v0   = lookupAverage(averages, parkSlug, rideId, b0,   dayType);
  const v30  = lookupAverage(averages, parkSlug, rideId, b30,  dayType);
  const v60  = lookupAverage(averages, parkSlug, rideId, b60,  dayType);
  const v90  = lookupAverage(averages, parkSlug, rideId, b90,  dayType);
  const v120 = lookupAverage(averages, parkSlug, rideId, b120, dayType);
  const v150 = lookupAverage(averages, parkSlug, rideId, b150, dayType);

  if (v0 === null) return { primary: null, baseline: null };

  const historicalBuckets: HistoricalAverage['buckets'] = [
    bucketEntry(0,   b0,   v0),
    bucketEntry(30,  b30,  v30),
    bucketEntry(60,  b60,  v60),
    bucketEntry(90,  b90,  v90),
    bucketEntry(120, b120, v120),
    bucketEntry(150, b150, v150),
  ];
  const historicalOnly: HistoricalAverage = { dayType, buckets: historicalBuckets };

  if (mlPred !== undefined && currentWait !== null) {
    const primary: HistoricalAverage = {
      dayType,
      buckets: [
        // bucket0 is always the live currentWait — use the real historical
        // sampleCount so the scorer's MIN_BUCKET_SAMPLE_COUNT gate fires
        // correctly. ML prediction buckets use sampleCount:1 (they're model
        // outputs, not raw observations).
        { offsetMinutes: 0 as const,   timeSlot: b0,   wait: currentWait,  sampleCount: v0?.sampleCount ?? 1 },
        { offsetMinutes: 30 as const,  timeSlot: b30,  wait: mlPred.t30,   sampleCount: 1 },
        { offsetMinutes: 60 as const,  timeSlot: b60,  wait: mlPred.t60,   sampleCount: 1 },
        { offsetMinutes: 90 as const,  timeSlot: b90,  wait: mlPred.t90,   sampleCount: 1 },
        { offsetMinutes: 120 as const, timeSlot: b120, wait: mlPred.t120,  sampleCount: 1 },
        { offsetMinutes: 150 as const, timeSlot: b150, wait: mlPred.t150,  sampleCount: 1 },
      ],
    };
    return { primary, baseline: historicalOnly };
  }

  return { primary: historicalOnly, baseline: null };
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

// All 30-min slots from 7:00 AM to 11:30 PM (34 slots). Covers the full
// operating range of any Disney park including early-entry hours.
const FULL_DAY_SLOTS: { timeSlot: string; startMinutes: number }[] = (() => {
  const slots: { timeSlot: string; startMinutes: number }[] = [];
  const p = (n: number) => n.toString().padStart(2, '0');
  for (let h = 7; h < 24; h++) {
    const hNext = h + 1;
    slots.push({ timeSlot: `${p(h)}:00-${p(h)}:30`,        startMinutes: h * 60 });
    slots.push({ timeSlot: `${p(h)}:30-${p(hNext % 24)}:00`, startMinutes: h * 60 + 30 });
  }
  return slots;
})();

async function buildFullDayForecast(
  parkSlug: ParkSlug,
  rideId: string,
  now: Date,
  mlPred?: MLPredictionDoc,
): Promise<FullDaySlot[] | null> {
  if (mlPred !== undefined && mlPred.full_day.length > 0) {
    return mlPred.full_day.map(s => ({
      timeSlot: s.time_slot,
      startMinutes: s.start_minutes,
      wait: s.wait,
      sampleCount: 1,
    }));
  }

  let averages: Map<string, { mean: number; sampleCount: number }>;
  try {
    averages = await ensureLoaded();
  } catch (err) {
    console.warn('historical_averages load failed; serving without fullDayForecast', err);
    return null;
  }
  const dayType = classifyDayType(now);
  const slots: FullDaySlot[] = FULL_DAY_SLOTS.map(({ timeSlot, startMinutes }) => {
    const v = lookupAverage(averages, parkSlug, rideId, timeSlot, dayType);
    return { timeSlot, startMinutes, wait: v?.mean ?? null, sampleCount: v?.sampleCount ?? 0 };
  });
  if (slots.every(s => s.wait === null)) return null;
  return slots;
}

function buildPrediction(mlPred: MLPredictionDoc): Prediction {
  return {
    t10:         mlPred.t10,
    t20:         mlPred.t20,
    t30:         mlPred.t30,
    t40:         mlPred.t40,
    t50:         mlPred.t50,
    t60:         mlPred.t60,
    t90:         mlPred.t90,
    t120:        mlPred.t120,
    t150:        mlPred.t150,
    trend:       mlPred.trend as Prediction['trend'],
    trendDelta30: mlPred.trend_delta_30,
    confidence:  mlPred.confidence as Prediction['confidence'],
    updatedAt:   mlPred.updated_at,
  };
}

export async function fetchPark(parkSlug: ParkSlug, referenceDate?: Date): Promise<ParkData> {
  // Skip cache for time-travel requests so historical data isn't served stale.
  if (!referenceDate) {
    const cached = parkCache.get(parkSlug);
    if (cached) return cached;
  }

  const now = referenceDate ?? new Date();
  const dayType = classifyDayType(now);
  const [live, recentHistoryMap, metadataMap, closuresMap, predictionsMap] = await Promise.all([
    fetchLiveData(parkSlug),
    fetchRecentHistory(parkSlug, now),
    ensureRideMetadataLoaded().catch(() => new Map()),
    // Best-effort: a missing/failed current_closures fetch just means no
    // closedAt timestamps, never a 5xx for the whole response.
    loadCurrentClosures().catch(() => new Map()),
    // Best-effort: missing predictions degrade gracefully to historical averages.
    loadPredictions().catch(() => new Map<string, import('./mlPredictions').MLPredictionDoc>()),
  ]);

  const allRides: Ride[] = await Promise.all(
    filterToRides(live.liveData).map(async entity => {
      const isOperating = entity.status === 'OPERATING';
      const currentWait = isOperating ? entity.queue?.STANDBY?.waitTime ?? null : null;
      const mlPred = predictionsMap.get(entity.id);
      // rideStats is looked up for all rides (not just operating) so the
      // non-ride filter below can use it to drop chronic walk-ons /
      // walkthroughs / experiences regardless of current status.
      const [haResult, rideStats, fullDayForecast] = await Promise.all([
        isOperating ? buildHistoricalAverage(parkSlug, entity.id, now, currentWait, mlPred) : Promise.resolve({ primary: null, baseline: null }),
        buildRideStats(parkSlug, entity.id, dayType),
        buildFullDayForecast(parkSlug, entity.id, now, mlPred),
      ]);
      const historicalAverage = haResult.primary;
      const historicalBaseline = haResult.baseline;
      const meta = lookupRideMetadata(metadataMap, entity.id);
      const status = entity.status ?? 'UNKNOWN';
      const ride: Ride = {
        id: entity.id,
        name: entity.name,
        land: resolveLand(entity.id, parkSlug),
        status,
        currentWait,
        historicalAverage,
        rideStats,
        prediction: mlPred ? buildPrediction(mlPred) : null,
        historicalBaseline,
        recentHistory: recentHistoryMap.get(entity.id) ?? null,
        lat: meta?.lat ?? null,
        lng: meta?.lng ?? null,
        // Only meaningful when status is DOWN — the scanner only records
        // OPERATING → DOWN transitions. For other states we leave null.
        closedAt: status === 'DOWN' ? lookupClosedAt(closuresMap, entity.id) : null,
        fullDayForecast,
      };
      ride.score = scoreRide(ride);
      return ride;
    })
  );

  // ride_metadata is the allowlist. Rides absent from it are walk-throughs,
  // exhibits, or other experiences the API reports as ATTRACTION but that
  // never have a standby queue. Rides present but flagged tracksWaitTime=false
  // are transportation / shows we've explicitly excluded.
  const rides = allRides.filter(r => {
    const meta = lookupRideMetadata(metadataMap, r.id);
    return meta != null && meta.tracksWaitTime !== false;
  });

  const data = shapeParkData(parkSlug, rides, now.toISOString());
  if (!referenceDate) parkCache.set(parkSlug, data);
  return data;
}

function corsHeaders(): Record<string, string> {
  const origin = process.env.CORS_ORIGIN ?? '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'x-api-key, content-type, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };
}

async function verifyAuth(event: APIGatewayProxyEvent): Promise<string | null> {
  const headers = event.headers ?? {};
  const authHeader = headers['authorization'] ?? headers['Authorization'] ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const { initFirebase } = await import('./firestoreClient');
    const app = initFirebase();
    const admin = await import('firebase-admin');
    const decoded = await admin.auth(app).verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
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
  | { kind: 'user-upsert' }
  | { kind: 'user-me' }
  | { kind: 'user-delete' }
  | { kind: 'user-trip' }
  | { kind: 'user-trip-claim-free' }
  | { kind: 'user-trip-purchase' }
  | { kind: 'promo-validate' }
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
    if (path.endsWith('/v1/users')) {
      return { kind: 'user-upsert' };
    }
    if (path.endsWith('/v1/users/trip/claim-free')) {
      return { kind: 'user-trip-claim-free' };
    }
    if (path.endsWith('/v1/users/trip/purchase')) {
      return { kind: 'user-trip-purchase' };
    }
    if (path.endsWith('/v1/promo/validate')) {
      return { kind: 'promo-validate' };
    }
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
    if (path.endsWith('/v1/users/me')) return { kind: 'user-me' };
    if (path.endsWith('/v1/users/trip')) return { kind: 'user-trip' };
    const notifListMatch = path.match(/\/v1\/devices\/([^/]+)\/notifications$/);
    if (notifListMatch) return { kind: 'device-notifications-list', deviceId: notifListMatch[1] };
  }
  if (method === 'DELETE' && path.endsWith('/v1/users/me')) {
    return { kind: 'user-delete' };
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

  if (route.kind === 'user-upsert') {
    return handleUserUpsert(event);
  }

  if (route.kind === 'user-me') {
    return handleUserMe(event);
  }

  if (route.kind === 'user-delete') {
    return handleUserDelete(event);
  }

  if (route.kind === 'user-trip') {
    return handleUserTrip(event);
  }

  if (route.kind === 'user-trip-claim-free') {
    return handleClaimFreeTrip(event);
  }

  if (route.kind === 'user-trip-purchase') {
    return handleTripPurchase(event);
  }

  if (route.kind === 'promo-validate') {
    return handlePromoValidate(event);
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
    tripEnd?: unknown;
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
    const tripEnd = typeof body.tripEnd === 'string' ? body.tripEnd : null;
    await upsertDevice(deviceId, {
      pushToken,
      pushTokenType,
      mustDoRideIds,
      notificationsEnabled,
      tripEnd,
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
  let body: { trough?: unknown; closure?: unknown; reopen?: unknown; peak?: unknown };
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

// --- User + trip endpoints ---

async function handleUserUpsert(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const uid = await verifyAuth(event);
  if (!uid) return jsonResponse(401, errorBody('UNAUTHORIZED', 'Valid Firebase ID token required'));

  let body: { appleId?: unknown; email?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'Body must be JSON'));
  }
  const appleId = typeof body.appleId === 'string' ? body.appleId : uid;
  const email = typeof body.email === 'string' ? body.email : null;

  try {
    const { record, isNew } = await upsertUser(uid, appleId, email);
    const trip = await getTrip(uid);
    const response: UserResponse = {
      userId: uid,
      freeTripClaimed: record.freeTripClaimed,
      bypass: record.bypass,
      isNew,
      trip,
    };
    return jsonResponse(200, response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse(500, errorBody('INTERNAL_ERROR', message));
  }
}

async function handleUserMe(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const uid = await verifyAuth(event);
  if (!uid) return jsonResponse(401, errorBody('UNAUTHORIZED', 'Valid Firebase ID token required'));

  try {
    const [record, trip] = await Promise.all([getUser(uid), getTrip(uid)]);
    if (!record) return jsonResponse(404, errorBody('NOT_FOUND', 'User not found'));

    const response: UserResponse = {
      userId: uid,
      freeTripClaimed: record.freeTripClaimed,
      bypass: record.bypass,
      isNew: false,
      trip,
    };
    return jsonResponse(200, response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse(500, errorBody('INTERNAL_ERROR', message));
  }
}

async function handleUserDelete(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const uid = await verifyAuth(event);
  if (!uid) return jsonResponse(401, errorBody('UNAUTHORIZED', 'Valid Firebase ID token required'));

  try {
    await deleteUserData(uid);
    return jsonResponse(200, { deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse(500, errorBody('INTERNAL_ERROR', message));
  }
}

async function handleUserTrip(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const uid = await verifyAuth(event);
  if (!uid) return jsonResponse(401, errorBody('UNAUTHORIZED', 'Valid Firebase ID token required'));

  try {
    const trip = await getTrip(uid);
    return jsonResponse(200, { trip });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse(500, errorBody('INTERNAL_ERROR', message));
  }
}

async function handleClaimFreeTrip(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const uid = await verifyAuth(event);
  if (!uid) return jsonResponse(401, errorBody('UNAUTHORIZED', 'Valid Firebase ID token required'));

  let body: { tripStart?: unknown; tripEnd?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'Body must be JSON'));
  }

  const tripStart = typeof body.tripStart === 'string' ? body.tripStart : null;
  const tripEnd = typeof body.tripEnd === 'string' ? body.tripEnd : null;
  if (!tripStart || !tripEnd) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'tripStart and tripEnd are required (YYYY-MM-DD)'));
  }

  try {
    const userRecord = await getUser(uid);
    if (!userRecord) return jsonResponse(404, errorBody('NOT_FOUND', 'User not found'));
    const trip = await claimFreeTrip(uid, userRecord.appleId, tripStart, tripEnd);
    return jsonResponse(200, { trip });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'Free trip already claimed' ? 409 : 500;
    return jsonResponse(status, errorBody(status === 409 ? 'CONFLICT' : 'INTERNAL_ERROR', message));
  }
}

async function handlePromoValidate(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const uid = await verifyAuth(event);
  if (!uid) return jsonResponse(401, errorBody('UNAUTHORIZED', 'Valid Firebase ID token required'));

  let body: { code?: unknown; tripStart?: unknown; tripEnd?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'Body must be JSON'));
  }

  const code = typeof body.code === 'string' ? body.code : null;
  const tripStart = typeof body.tripStart === 'string' ? body.tripStart : null;
  const tripEnd = typeof body.tripEnd === 'string' ? body.tripEnd : null;
  if (!code || !tripStart || !tripEnd) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'code, tripStart, and tripEnd are required'));
  }

  try {
    const trip = await validatePromoCode(uid, code, tripStart, tripEnd);
    return jsonResponse(200, { trip });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Validation failures are 422 so the frontend can surface them directly.
    const isValidationError = [
      'Invalid promo code',
      'This code is no longer active',
      'This code has expired',
      'This code has been fully redeemed',
    ].includes(message);
    return jsonResponse(
      isValidationError ? 422 : 500,
      errorBody(isValidationError ? 'INVALID_PROMO' : 'INTERNAL_ERROR', message)
    );
  }
}

async function handleTripPurchase(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const uid = await verifyAuth(event);
  if (!uid) return jsonResponse(401, errorBody('UNAUTHORIZED', 'Invalid or missing token'));

  let body: { receiptData?: unknown; tripStart?: unknown; tripEnd?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'Body must be JSON'));
  }

  const receiptData = typeof body.receiptData === 'string' ? body.receiptData : null;
  const tripStart   = typeof body.tripStart   === 'string' ? body.tripStart   : null;
  const tripEnd     = typeof body.tripEnd     === 'string' ? body.tripEnd     : null;

  if (!receiptData || !tripStart || !tripEnd) {
    return jsonResponse(400, errorBody('BAD_REQUEST', 'receiptData, tripStart, and tripEnd are required'));
  }

  try {
    const trip = await purchaseTrip(uid, receiptData, tripStart, tripEnd);
    return jsonResponse(200, { trip });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const isVerifyError = message.startsWith('Apple receipt verification failed');
    return jsonResponse(
      isVerifyError ? 422 : 500,
      errorBody(isVerifyError ? 'RECEIPT_INVALID' : 'INTERNAL_ERROR', message)
    );
  }
}

// Test helper — clears the module-level caches between tests.
export function _resetCacheForTests(): void {
  parkCache.clear();
  recsCache.clear();
}
