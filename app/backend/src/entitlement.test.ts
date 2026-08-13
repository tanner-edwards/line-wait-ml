import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Ride, TripRecord, UserRecord } from './types';

// Control the token verification + Firestore reads that resolveEntitlement
// depends on. verifyAuthClaims dynamically imports these two.
jest.mock('./firestoreClient', () => ({ initFirebase: jest.fn(() => ({})) }));
const mockVerifyIdToken = jest.fn();
jest.mock('firebase-admin', () => ({ auth: jest.fn(() => ({ verifyIdToken: mockVerifyIdToken })) }));
jest.mock('./users', () => ({ getUser: jest.fn(), getTrip: jest.fn() }));

import {
  isTripActive,
  stripPremiumFromRide,
  resolveEntitlement,
  _resetEntitlementCacheForTests,
} from './entitlement';
import { getUser, getTrip } from './users';

const mockedGetUser = getUser as jest.Mock;
const mockedGetTrip = getTrip as jest.Mock;

function trip(tripStart: string, tripEnd: string): TripRecord {
  return { id: 'trip-1', uid: 'u1', tripStart, tripEnd, purchasedAt: '2026-01-01T00:00:00Z', source: 'iap' };
}

// A fixed "now" in the afternoon UTC so the LA-local date is unambiguous.
// 2026-07-15T20:00:00Z === 2026-07-15 13:00 America/Los_Angeles.
const NOW = new Date('2026-07-15T20:00:00Z');

describe('isTripActive', () => {
  it('is false for a null trip', () => {
    expect(isTripActive(null, NOW)).toBe(false);
  });

  it('is true mid-trip', () => {
    expect(isTripActive(trip('2026-07-13', '2026-07-18'), NOW)).toBe(true);
  });

  it('is true on the last day (inclusive of the whole tripEnd day)', () => {
    expect(isTripActive(trip('2026-07-10', '2026-07-15'), NOW)).toBe(true);
  });

  it('is false the day after tripEnd', () => {
    expect(isTripActive(trip('2026-07-10', '2026-07-14'), NOW)).toBe(false);
  });

  it('is true one day before tripStart (travel-day grace)', () => {
    expect(isTripActive(trip('2026-07-16', '2026-07-20'), NOW)).toBe(true);
  });

  it('is false two days before tripStart (grace does not reach)', () => {
    expect(isTripActive(trip('2026-07-17', '2026-07-20'), NOW)).toBe(false);
  });
});

describe('stripPremiumFromRide', () => {
  function fullRide(): Ride {
    const ride: Ride = {
      id: 'r1', name: 'Test', land: 'Tomorrowland', status: 'OPERATING',
      currentWait: 40,
      historicalAverage: {
        dayType: 'weekday',
        buckets: [] as unknown as NonNullable<Ride['historicalAverage']>['buckets'],
      },
      rideStats: { p10: 10, p50: 30, p90: 60, sampleCount: 20 },
      prediction: null,
      recentHistory: [{ timestamp: 't', minutesAgo: 5, wait: 40, status: 'OPERATING' }],
      lat: 1, lng: 2, closedAt: null,
      predictedReopenAt: '2026-07-15T21:00:00Z',
      verdict: {
        verdict: 'star',
        reasons: {
          primary: 'rare-low', current: 5, typical: 30, todayP30: 20, todayP80: 55,
          p10: 10, p90: 60, beatableSoon: false, betterWindowWait: null, betterWindowInMin: null, star: true,
        },
      },
      fullDayForecast: [{ timeSlot: '08:00-08:30', startMinutes: 480, wait: 20, sampleCount: 5 }],
      closureProfile: {
        closureType: 'blip', elapsedMinutes: 10, blipEstimateMinutes: 15,
        breakEstimateMinutes: 60, predictedReopenWait: null,
        confidenceLevel: 'high', postReopenWaitDrop: false,
      },
    };
    return ride;
  }

  it('nulls the four premium fields and downgrades a star badge to go', () => {
    const stripped = stripPremiumFromRide(fullRide());
    expect(stripped.rideStats).toBeNull();
    expect(stripped.fullDayForecast).toBeNull();
    expect(stripped.closureProfile).toBeNull();
    expect(stripped.predictedReopenAt).toBeNull();
    expect(stripped.verdict?.verdict).toBe('go');   // star → go for non-entitled
  });

  it('leaves free/current-state fields intact', () => {
    const stripped = stripPremiumFromRide(fullRide());
    expect(stripped.currentWait).toBe(40);
    expect(stripped.recentHistory).not.toBeNull();
    expect(stripped.historicalAverage).not.toBeNull();
    expect(stripped.lat).toBe(1);
  });

  it('leaves non-star verdicts unchanged', () => {
    const r = fullRide();
    r.verdict = { ...r.verdict!, verdict: 'skip' };
    expect(stripPremiumFromRide(r).verdict?.verdict).toBe('skip');
  });

  it('strips the two-layer verdict: star→go, rare-low→todays-low, reason numbers nulled', () => {
    const stripped = stripPremiumFromRide(fullRide());
    expect(stripped.verdict?.verdict).toBe('go');
    expect(stripped.verdict?.reasons.primary).toBe('todays-low');
    expect(stripped.verdict?.reasons.star).toBe(false);
    // raw predictive numbers behind the "why" are removed for non-entitled users
    expect(stripped.verdict?.reasons.typical).toBeNull();
    expect(stripped.verdict?.reasons.p10).toBeNull();
    expect(stripped.verdict?.reasons.p90).toBeNull();
    expect(stripped.verdict?.reasons.todayP30).toBeNull();
    expect(stripped.verdict?.reasons.todayP80).toBeNull();
  });

  it('leaves a non-star verdict label unchanged', () => {
    const r = fullRide();
    r.verdict = { ...r.verdict!, verdict: 'skip', reasons: { ...r.verdict!.reasons, primary: 'at-ceiling', star: false } };
    expect(stripPremiumFromRide(r).verdict?.verdict).toBe('skip');
    expect(stripPremiumFromRide(r).verdict?.reasons.primary).toBe('at-ceiling');
  });

  it('does not mutate the input ride', () => {
    const r = fullRide();
    stripPremiumFromRide(r);
    expect(r.rideStats).not.toBeNull();
    expect(r.verdict?.verdict).toBe('star');
    expect(r.verdict?.reasons.typical).toBe(30);
  });
});

describe('resolveEntitlement', () => {
  function eventWithToken(token: string | null): APIGatewayProxyEvent {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    return { headers } as unknown as APIGatewayProxyEvent;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    _resetEntitlementCacheForTests();
    delete process.env.ALLOW_ANONYMOUS_PREMIUM;
  });

  it('is false with no token', async () => {
    expect(await resolveEntitlement(eventWithToken(null))).toBe(false);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('is false when the token fails verification', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    expect(await resolveEntitlement(eventWithToken('xyz'))).toBe(false);
  });

  it('anonymous → free tier unless ALLOW_ANONYMOUS_PREMIUM=true', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'anon', firebase: { sign_in_provider: 'anonymous' } });
    expect(await resolveEntitlement(eventWithToken('t'))).toBe(false);

    process.env.ALLOW_ANONYMOUS_PREMIUM = 'true';
    expect(await resolveEntitlement(eventWithToken('t'))).toBe(true);
    // Anonymous path does no Firestore reads.
    expect(mockedGetUser).not.toHaveBeenCalled();
  });

  it('real user with an active trip is entitled', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', firebase: { sign_in_provider: 'apple.com' } });
    mockedGetUser.mockResolvedValue({ bypass: false } as UserRecord);
    mockedGetTrip.mockResolvedValue(trip('2026-07-13', '2100-01-01'));
    expect(await resolveEntitlement(eventWithToken('t'))).toBe(true);
  });

  it('real user with an expired trip is NOT entitled', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u2', firebase: { sign_in_provider: 'apple.com' } });
    mockedGetUser.mockResolvedValue({ bypass: false } as UserRecord);
    mockedGetTrip.mockResolvedValue(trip('2020-01-01', '2020-01-05'));
    expect(await resolveEntitlement(eventWithToken('t'))).toBe(false);
  });

  it('bypass flag entitles a real user regardless of trip', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u3', firebase: { sign_in_provider: 'apple.com' } });
    mockedGetUser.mockResolvedValue({ bypass: true } as UserRecord);
    mockedGetTrip.mockResolvedValue(null);
    expect(await resolveEntitlement(eventWithToken('t'))).toBe(true);
  });

  it('caches the per-uid decision (second call does no extra Firestore reads)', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u4', firebase: { sign_in_provider: 'apple.com' } });
    mockedGetUser.mockResolvedValue({ bypass: true } as UserRecord);
    mockedGetTrip.mockResolvedValue(null);
    await resolveEntitlement(eventWithToken('t'));
    await resolveEntitlement(eventWithToken('t'));
    expect(mockedGetUser).toHaveBeenCalledTimes(1);
  });
});
