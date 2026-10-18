// Regression for the 2026-10-16/17 outage: a bare tombstone doc (no full_day)
// made buildFullDayForecast throw, failing fetchPark for both parks and
// 502-ing /v0/waits. One bad predictions doc must degrade one ride, never the
// endpoint.

import { _resetCacheForTests, handler } from './handler';
import * as themeparksClient from './themeparksClient';
import * as historicalAverages from './historicalAverages';
import * as mlPredictions from './mlPredictions';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { CombinedResponse, ParkData, RideMetadata, ThemeparksLiveResponse } from './types';

jest.mock('./themeparksClient');
jest.mock('./historicalAverages', () => {
  const actual = jest.requireActual<typeof import('./historicalAverages')>('./historicalAverages');
  return { ...actual, ensureLoaded: jest.fn() };
});
jest.mock('./recentHistory', () => ({
  fetchRecentHistory: jest.fn().mockResolvedValue(new Map()),
  _resetForTests: jest.fn(),
}));
// Real isUsablePrediction (the handler's defensive guard); only the Firestore
// read is replaced so the test controls exactly which docs reach the handler.
jest.mock('./mlPredictions', () => {
  const actual = jest.requireActual<typeof import('./mlPredictions')>('./mlPredictions');
  return { ...actual, loadPredictions: jest.fn() };
});
jest.mock('./recommendations/rideMetadata', () => {
  const map = new Map<string, RideMetadata>([
    ['9167db1d-e5e7-46da-a07f-ae30a87bc4c4', { rideId: '9167db1d-e5e7-46da-a07f-ae30a87bc4c4', parkId: 'dlr', name: 'Hyperspace Mountain', lat: null, lng: null, source: 'manual' }],
    ['c23af6ba-8515-406a-8a48-d0818ba0bfc9', { rideId: 'c23af6ba-8515-406a-8a48-d0818ba0bfc9', parkId: 'dlr', name: "Peter Pan's Flight", lat: null, lng: null, source: 'manual' }],
    ['c60c768b-3461-465c-8f4f-b44b087506fc', { rideId: 'c60c768b-3461-465c-8f4f-b44b087506fc', parkId: 'dca', name: 'Radiator Springs Racers', lat: null, lng: null, source: 'manual' }],
  ]);
  return {
    ensureRideMetadataLoaded: jest.fn().mockResolvedValue(map),
    lookupRideMetadata: jest.fn((m: typeof map, id: string) => m.get(id) ?? null),
  };
});
jest.mock('./entitlement', () => {
  const actual = jest.requireActual<typeof import('./entitlement')>('./entitlement');
  return { ...actual, resolveEntitlement: jest.fn().mockResolvedValue(true) };
});

const mockedClient = themeparksClient as jest.Mocked<typeof themeparksClient>;
const mockedHistorical = historicalAverages as jest.Mocked<typeof historicalAverages>;
const mockedLoadPredictions = mlPredictions.loadPredictions as jest.Mock;

const SPACE_MTN_ID = '9167db1d-e5e7-46da-a07f-ae30a87bc4c4';
const PETER_PAN_ID = 'c23af6ba-8515-406a-8a48-d0818ba0bfc9';
const RADIATOR_ID = 'c60c768b-3461-465c-8f4f-b44b087506fc';

const disneylandLive: ThemeparksLiveResponse = {
  id: '7340550b-c14d-4def-80bb-acdb51d49a66',
  name: 'Disneyland Park',
  liveData: [
    { id: SPACE_MTN_ID, name: 'Hyperspace Mountain', entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: 55 } } },
    { id: PETER_PAN_ID, name: "Peter Pan's Flight", entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: 30 } } },
  ],
};
const dcaLive: ThemeparksLiveResponse = {
  id: '832fcd51-ea19-4e77-85c7-75d5843b127c',
  name: 'Disney California Adventure',
  liveData: [
    { id: RADIATOR_ID, name: 'Radiator Springs Racers', entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: 80 } } },
  ],
};

function healthyDoc(rideId: string, wait: number) {
  return {
    ride_id: rideId,
    updated_at: new Date().toISOString(),
    t10: wait, t20: wait, t30: wait, t40: wait, t50: wait, t60: wait,
    t90: wait, t120: wait, t150: wait, t180: wait, t210: wait, t240: wait,
    trend: 'stable',
    trend_delta_30: 0,
    confidence: 'high',
    full_day: [{ time_slot: '12:00-12:30', start_minutes: 720, wait }],
  };
}

function event(path: string): APIGatewayProxyEvent {
  return { path, headers: { 'x-api-key': 'test-api-key' }, queryStringParameters: null } as unknown as APIGatewayProxyEvent;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetCacheForTests();
  historicalAverages._resetForTests();
  process.env.API_KEY = 'test-api-key';
  mockedClient.fetchLiveData.mockImplementation(async slug => {
    if (slug === 'disneyland') return disneylandLive;
    if (slug === 'california-adventure') return dcaLive;
    throw new Error('unexpected park slug');
  });
  mockedHistorical.ensureLoaded.mockResolvedValue(new Map());
});

describe('handler — malformed predictions docs', () => {
  it('serves every ride when one doc throws during assembly and one is a bare tombstone', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedLoadPredictions.mockResolvedValue(new Map<string, unknown>([
      // Passes isUsablePrediction but throws inside buildFullDayForecast
      // (null slot) — exercises the per-ride try/catch.
      [SPACE_MTN_ID, { ...healthyDoc(SPACE_MTN_ID, 55), full_day: [null] }],
      // The outage shape with degraded missing: no t*, no full_day —
      // exercises the handler's isUsablePrediction guard.
      [PETER_PAN_ID, { ride_id: PETER_PAN_ID, updated_at: new Date().toISOString(), degraded_reason: 'insufficient_history' }],
      [RADIATOR_ID, healthyDoc(RADIATOR_ID, 80)],
    ]));

    const result = await handler(event('/v0/waits'));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body) as CombinedResponse;
    const dl = body.parks[0] as ParkData;
    const dca = body.parks[1] as ParkData;
    expect(dl.rides).toHaveLength(2);
    expect(dca.rides).toHaveLength(1);

    const space = dl.rides.find(r => r.id === SPACE_MTN_ID)!;
    expect(space.prediction).toBeNull();
    expect(space.currentWait).toBe(55);
    expect(space.status).toBe('OPERATING');
    expect(space.verdict).toBeDefined();

    const peterPan = dl.rides.find(r => r.id === PETER_PAN_ID)!;
    expect(peterPan.prediction).toBeNull();
    expect(peterPan.currentWait).toBe(30);

    expect(dca.rides[0].prediction).toMatchObject({ t30: 80, trend: 'stable', confidence: 'high' });
    expect(dca.rides[0].fullDayForecast).toEqual([
      { timeSlot: '12:00-12:30', startMinutes: 720, wait: 80, sampleCount: 1 },
    ]);

    expect(error).toHaveBeenCalledWith(expect.stringContaining(SPACE_MTN_ID), expect.anything());
    error.mockRestore();
  });

  it('falls back to the historical curve when full_day is missing', async () => {
    const { full_day: _omit, ...noFullDay } = healthyDoc(RADIATOR_ID, 80);
    mockedLoadPredictions.mockResolvedValue(new Map<string, unknown>([[RADIATOR_ID, noFullDay]]));

    const result = await handler(event('/v0/waits/california-adventure'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as ParkData;
    expect(body.rides[0].prediction).toBeNull();
    // No historical averages loaded in this test, so the fallback curve is null.
    expect(body.rides[0].fullDayForecast).toBeNull();
  });
});
