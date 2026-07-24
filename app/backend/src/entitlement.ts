// Server-side paywall enforcement — the single source of truth for "is this
// caller entitled to premium (predictive) data?".
//
// The client also computes `hasActiveTrip` for instant UX, but the client is
// no longer load-bearing for security: these functions let the backend strip
// premium fields (or reject the recommendations endpoint outright) for anyone
// who isn't paid up, regardless of what the client claims.
//
// Entitlement rule (mirrors app/frontend/src/context/TripContext.tsx):
//   - no / invalid Firebase token            → not entitled (free tier)
//   - anonymous token                        → entitled ONLY when the
//                                              ALLOW_ANONYMOUS_PREMIUM env flag
//                                              is set (dev / web-demo); free
//                                              tier in prod
//   - real account                           → bypass flag OR active trip

import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Ride, TripRecord } from './types';
import { getUser, getTrip } from './users';

// --- token verification -----------------------------------------------------

export interface AuthClaims {
  uid: string;
  isAnonymous: boolean;
}

// Verifies the Bearer token and reports both the uid and whether the sign-in
// was anonymous. Returns null on missing/invalid token (callers treat null as
// "unauthenticated → free tier"). handler.ts's verifyAuth delegates here so
// token parsing lives in exactly one place.
export async function verifyAuthClaims(
  event: APIGatewayProxyEvent
): Promise<AuthClaims | null> {
  const headers = event.headers ?? {};
  const authHeader = headers['authorization'] ?? headers['Authorization'] ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const { initFirebase } = await import('./firestoreClient');
    const app = initFirebase();
    const admin = await import('firebase-admin');
    const decoded = await admin.auth(app).verifyIdToken(token);
    return {
      uid: decoded.uid,
      isAnonymous: decoded.firebase?.sign_in_provider === 'anonymous',
    };
  } catch {
    return null;
  }
}

// --- trip-active date logic --------------------------------------------------

// "Today" in a fixed park timezone. We deliberately use America/Los_Angeles
// (the westernmost resort) rather than UTC so the day boundary matches the
// user's local day and errs toward NOT locking out a paying user — a WDW /
// Eastern guest simply gets up to 3h of extra leniency at the tripEnd
// boundary. en-CA formats as YYYY-MM-DD, which sorts lexicographically.
function parkTodayString(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
  }).format(now);
}

// Shift a YYYY-MM-DD date string by whole days. Anchored at noon UTC so a
// ±1-day shift never lands on a DST transition and flips the date.
function shiftDateString(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// Mirrors TripContext.isTripActive: today ∈ [tripStart − 1 day, tripEnd],
// inclusive of the whole tripEnd day. The −1 day is the travel-day grace.
export function isTripActive(trip: TripRecord | null, now: Date = new Date()): boolean {
  if (!trip) return false;
  const today = parkTodayString(now);
  const start = shiftDateString(trip.tripStart, -1);
  return today >= start && today <= trip.tripEnd;
}

// --- per-uid entitlement cache ----------------------------------------------

// The data endpoints are polled, so an uncached lookup would do two Firestore
// reads on every request. Cache the decision per uid for a short window; a
// purchase/claim/promo write invalidates the entry in-process (cross-container
// staleness is bounded by the TTL).
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  entitled: boolean;
  expiresAt: number;
}

const entitlementCache = new Map<string, CacheEntry>();

export function invalidateEntitlement(uid: string): void {
  entitlementCache.delete(uid);
}

async function isEntitledUid(uid: string): Promise<boolean> {
  const now = Date.now();
  const hit = entitlementCache.get(uid);
  if (hit && hit.expiresAt > now) return hit.entitled;

  const [user, trip] = await Promise.all([getUser(uid), getTrip(uid)]);
  const entitled = (user?.bypass ?? false) || isTripActive(trip, new Date(now));

  entitlementCache.set(uid, { entitled, expiresAt: now + CACHE_TTL_MS });
  return entitled;
}

// --- top-level resolver ------------------------------------------------------

// The one call handler routes make per request. Cheap for the unauthenticated
// and anonymous paths (no Firestore reads).
export async function resolveEntitlement(event: APIGatewayProxyEvent): Promise<boolean> {
  const claims = await verifyAuthClaims(event);
  if (!claims) return false;
  if (claims.isAnonymous) {
    return process.env.ALLOW_ANONYMOUS_PREMIUM === 'true';
  }
  return isEntitledUid(claims.uid);
}

// --- premium-field stripping -------------------------------------------------

// Returns a shallow copy of the ride with premium (predictive) fields nulled,
// matching exactly what the client hides for a non-entitled user. Free /
// current-state fields (currentWait, historicalAverage, prediction chart,
// recentHistory, closedAt, persona facts) are left intact. Never mutates the
// input — park responses are served from a shared TTL cache.
export function stripPremiumFromRide(ride: Ride): Ride {
  const score = ride.score
    ? { ...ride.score, badge: ride.score.badge === 'star' ? ('go' as const) : ride.score.badge }
    : ride.score;
  return {
    ...ride,
    rideStats: null,
    fullDayForecast: null,
    closureProfile: null,
    predictedReopenAt: null,
    score,
  };
}

// Test helper — clears the module-level entitlement cache between tests.
export function _resetEntitlementCacheForTests(): void {
  entitlementCache.clear();
}
