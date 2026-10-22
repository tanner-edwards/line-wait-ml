// The far-away downgrade gate (Session 5): go/star → neutral when p_rise_30 is
// at or above P_RISE_ALERT_THRESHOLD, the current wait is above 10, and the
// user is more than 15 walking minutes away. It replaced the reversion-model
// gate (pct_rank ≤ 0.15 && reversion_prob > 0.35), which had no test.

import { _resetCacheForTests, handler } from './handler';
import * as themeparksClient from './themeparksClient';
import * as historicalAverages from './historicalAverages';
import * as mlPredictions from './mlPredictions';
import { ALERT_MIN_CURRENT_WAIT, P_RISE_ALERT_THRESHOLD } from './mlPredictions';
import { scoreVerdict } from './scoring/layer2';
import { walkingMinutes } from './recommendations/walkingDistance';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { ParkData, RideMetadata, ThemeparksLiveResponse, Verdict } from './types';

jest.mock('./themeparksClient');
jest.mock('./historicalAverages', () => {
  const actual = jest.requireActual<typeof import('./historicalAverages')>('./historicalAverages');
  return { ...actual, ensureLoaded: jest.fn() };
});
jest.mock('./recentHistory', () => ({
  fetchRecentHistory: jest.fn().mockResolvedValue(new Map()),
  _resetForTests: jest.fn(),
}));
jest.mock('./mlPredictions', () => {
  const actual = jest.requireActual<typeof import('./mlPredictions')>('./mlPredictions');
  return { ...actual, loadPredictions: jest.fn() };
});
jest.mock('./recommendations/rideMetadata', () => {
  const map = new Map<string, RideMetadata>([
    ['9167db1d-e5e7-46da-a07f-ae30a87bc4c4', { rideId: '9167db1d-e5e7-46da-a07f-ae30a87bc4c4', parkId: 'dlr', name: 'Hyperspace Mountain', lat: 33.811, lng: -117.917, source: 'manual' }],
  ]);
  return {
    ensureRideMetadataLoaded: jest.fn().mockResolvedValue(map),
    lookupRideMetadata: jest.fn((m: typeof map, id: string) => m.get(id) ?? null),
  };
});
// The verdict engine and the walking estimate are inputs to the gate, not
// what is under test: each test sets them.
jest.mock('./scoring/layer2', () => ({ scoreVerdict: jest.fn() }));
jest.mock('./recommendations/walkingDistance', () => {
  const actual = jest.requireActual<typeof import('./recommendations/walkingDistance')>('./recommendations/walkingDistance');
  return { ...actual, walkingMinutes: jest.fn() };
});
jest.mock('./entitlement', () => {
  const actual = jest.requireActual<typeof import('./entitlement')>('./entitlement');
  return { ...actual, resolveEntitlement: jest.fn().mockResolvedValue(true) };
});

// Copied from the alert block of the Session 5 decision
// (reports/eval/2026-10-21_session5-classifiers.md, "Decisions"), which the
// export writes to models/manifest.json as `alert`. If the manifest's number
// changes, change both this fixture and P_RISE_ALERT_THRESHOLD.
const MANIFEST_ALERT = { field: 'p_rise_30', threshold: 0.5, min_current_wait: 10 };

const mockedClient = themeparksClient as jest.Mocked<typeof themeparksClient>;
const mockedHistorical = historicalAverages as jest.Mocked<typeof historicalAverages>;
const mockedLoadPredictions = mlPredictions.loadPredictions as jest.Mock;
const mockedScore = scoreVerdict as jest.Mock;
const mockedWalk = walkingMinutes as jest.Mock;

const SPACE_MTN_ID = '9167db1d-e5e7-46da-a07f-ae30a87bc4c4';

function live(wait: number): ThemeparksLiveResponse {
  return {
    id: '7340550b-c14d-4def-80bb-acdb51d49a66',
    name: 'Disneyland Park',
    liveData: [
      { id: SPACE_MTN_ID, name: 'Hyperspace Mountain', entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: wait } } },
    ],
  };
}

function doc(wait: number, extra: Record<string, unknown> = {}) {
  return {
    ride_id: SPACE_MTN_ID,
    updated_at: new Date().toISOString(),
    t10: wait, t20: wait, t30: wait, t40: wait, t50: wait, t60: wait,
    t90: wait, t120: wait, t150: wait, t180: wait, t210: wait, t240: wait,
    trend: 'rising',
    trend_delta_30: 0,
    confidence: 'medium',
    trend_source: 'classifier',
    full_day: [{ time_slot: '12:00-12:30', start_minutes: 720, wait }],
    ...extra,
  };
}

function verdictResult(verdict: Verdict, current: number) {
  return {
    verdict,
    deal: {},
    worthy: true,
    suppressed: false,
    star: verdict === 'star',
    reasons: {
      primary: verdict === 'star' ? 'rare-low' : verdict === 'go' ? 'below-usual' : 'at-ceiling',
      current, typical: 45, todayP30: null, todayP80: null, p10: 10, p90: 60,
      beatableSoon: false, betterWindowWait: null, betterWindowInMin: null, star: verdict === 'star',
    },
  };
}

interface Case {
  current?: number;
  pRise?: number | null;
  walk?: number | null;
  verdict?: Verdict;
  withLocation?: boolean;
}

async function verdictFor({ current = 30, pRise = 0.9, walk = 20, verdict = 'go', withLocation = true }: Case) {
  _resetCacheForTests();  // fetchPark caches per park; each call is a fresh scenario
  mockedClient.fetchLiveData.mockResolvedValue(live(current));
  const extra = pRise === null ? {} : { p_rise_30: pRise, p_fall_30: 0.05 };
  mockedLoadPredictions.mockResolvedValue(new Map([[SPACE_MTN_ID, doc(current, extra)]]));
  mockedScore.mockReturnValue(verdictResult(verdict, current));
  mockedWalk.mockReturnValue(walk);
  const qs = withLocation ? { user_lat: '33.812', user_lng: '-117.918' } : null;
  const event = {
    path: '/v0/waits/disneyland',
    headers: { 'x-api-key': 'test-api-key' },
    queryStringParameters: qs,
  } as unknown as APIGatewayProxyEvent;
  const result = await handler(event);
  expect(result.statusCode).toBe(200);
  const ride = (JSON.parse(result.body) as ParkData).rides[0];
  return ride.verdict!;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetCacheForTests();
  historicalAverages._resetForTests();
  process.env.API_KEY = 'test-api-key';
  mockedHistorical.ensureLoaded.mockResolvedValue(new Map());
});

describe('far-away downgrade gate (p_rise_30)', () => {
  it('fires at the threshold: go → neutral at current 30, 20 walking minutes', async () => {
    const v = await verdictFor({ pRise: P_RISE_ALERT_THRESHOLD });
    expect(v.verdict).toBe('neutral');
    expect(v.reasons.primary).toBe('none');
    expect(v.reasons.star).toBe(false);
  });

  it('fires on star too', async () => {
    const v = await verdictFor({ verdict: 'star' });
    expect(v.verdict).toBe('neutral');
    expect(v.reasons.star).toBe(false);
  });

  it('does not fire just under the threshold', async () => {
    const v = await verdictFor({ pRise: P_RISE_ALERT_THRESHOLD - 0.001 });
    expect(v.verdict).toBe('go');
  });

  it('never fires at current ≤ 10', async () => {
    expect(ALERT_MIN_CURRENT_WAIT).toBe(10);
    const v = await verdictFor({ current: 10, pRise: 0.99 });
    expect(v.verdict).toBe('go');
    expect((await verdictFor({ current: 5, pRise: 0.99 })).verdict).toBe('go');
    expect((await verdictFor({ current: 15, pRise: 0.99 })).verdict).toBe('neutral');
  });

  it('does not fire on a doc without p_rise_30 (older models)', async () => {
    const v = await verdictFor({ pRise: null });
    expect(v.verdict).toBe('go');
  });

  it('does not fire within 15 walking minutes, or with no walking estimate', async () => {
    expect((await verdictFor({ walk: 15 })).verdict).toBe('go');
    expect((await verdictFor({ walk: 10 })).verdict).toBe('go');
    expect((await verdictFor({ walk: null })).verdict).toBe('go');
  });

  it('does not fire without the user location', async () => {
    expect((await verdictFor({ withLocation: false })).verdict).toBe('go');
  });

  it('leaves skip and neutral alone', async () => {
    expect((await verdictFor({ verdict: 'skip' })).verdict).toBe('skip');
    expect((await verdictFor({ verdict: 'neutral' })).verdict).toBe('neutral');
  });

  it('maps curve_confidence to prediction.curveConfidence, falling back to confidence', async () => {
    const get = async (extra: Record<string, unknown>) => {
      _resetCacheForTests();
      mockedClient.fetchLiveData.mockResolvedValue(live(30));
      mockedLoadPredictions.mockResolvedValue(new Map([[SPACE_MTN_ID, doc(30, extra)]]));
      mockedScore.mockReturnValue(verdictResult('neutral', 30));
      const res = await handler({ path: '/v0/waits/disneyland', headers: { 'x-api-key': 'test-api-key' },
        queryStringParameters: null } as unknown as APIGatewayProxyEvent);
      return (JSON.parse(res.body) as ParkData).rides[0].prediction!;
    };
    expect((await get({ curve_confidence: 'high' })).curveConfidence).toBe('high');
    const old = await get({});
    expect(old.confidence).toBe('medium');
    expect(old.curveConfidence).toBe('medium');
  });

  it('threshold matches the manifest alert block', () => {
    expect(MANIFEST_ALERT.field).toBe('p_rise_30');
    expect(P_RISE_ALERT_THRESHOLD).toBe(MANIFEST_ALERT.threshold);
    expect(ALERT_MIN_CURRENT_WAIT).toBe(MANIFEST_ALERT.min_current_wait);
  });
});
