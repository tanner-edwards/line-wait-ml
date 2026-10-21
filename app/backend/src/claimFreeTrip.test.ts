// Endpoint-level tests for the freeTrip feature flag: POST
// /v1/users/trip/claim-free and GET /v1/flags. Firestore and auth are mocked
// at the module boundary, the same as feedback.test.ts.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { _resetCacheForTests, handler } from './handler';
import { _resetForTests as resetFlags } from './featureFlags';

const mockFlagsGet = jest.fn();
jest.mock('./firestoreClient', () => ({
  initFirebase: jest.fn(() => ({})),
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({ doc: jest.fn(() => ({ get: mockFlagsGet })) })),
  })),
}));
const mockVerifyIdToken = jest.fn();
jest.mock('firebase-admin', () => ({ auth: jest.fn(() => ({ verifyIdToken: mockVerifyIdToken })) }));

jest.mock('./users', () => {
  const actual = jest.requireActual<typeof import('./users')>('./users');
  return { ...actual, getUser: jest.fn(), claimFreeTrip: jest.fn() };
});
jest.mock('./devices/devices', () => {
  const actual = jest.requireActual<typeof import('./devices/devices')>('./devices/devices');
  return { ...actual, resetRetiredRideIdsForUid: jest.fn().mockResolvedValue(undefined) };
});
jest.mock('./recentHistory', () => ({
  fetchRecentHistory: jest.fn().mockResolvedValue(new Map()),
  _resetForTests: jest.fn(),
}));
jest.mock('./notificationLog', () => ({
  loadDeviceNotifications: jest.fn().mockResolvedValue([]),
}));

import * as usersModule from './users';
const mockedGetUser = usersModule.getUser as jest.Mock;
const mockedClaimFreeTrip = usersModule.claimFreeTrip as jest.Mock;

const TRIP = {
  id: 'trip-1', uid: 'u1', tripStart: '2026-11-01', tripEnd: '2026-11-03',
  purchasedAt: '2026-10-21T00:00:00Z', source: 'free',
};

function flagsDoc(data: object | null): void {
  mockFlagsGet.mockResolvedValue({ exists: data !== null, data: () => data });
}

function claimEvent(appVersion: string | null): APIGatewayProxyEvent {
  const headers: Record<string, string> = {
    'x-api-key': 'test-api-key',
    authorization: 'Bearer valid-token',
  };
  if (appVersion !== null) headers['x-app-version'] = appVersion;
  return {
    path: '/v1/users/trip/claim-free',
    httpMethod: 'POST',
    headers,
    body: JSON.stringify({ tripStart: TRIP.tripStart, tripEnd: TRIP.tripEnd }),
  } as unknown as APIGatewayProxyEvent;
}

function flagsEvent(appVersion: string | null): APIGatewayProxyEvent {
  const headers: Record<string, string> = { 'x-api-key': 'test-api-key' };
  if (appVersion !== null) headers['x-app-version'] = appVersion;
  return { path: '/v1/flags', httpMethod: 'GET', headers } as unknown as APIGatewayProxyEvent;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetCacheForTests();
  resetFlags();
  process.env.API_KEY = 'test-api-key';
  process.env.CORS_ORIGIN = '*';
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u1',
    firebase: { sign_in_provider: 'apple.com', identities: { 'apple.com': ['apple-sub-1'] } },
  });
  mockedGetUser.mockResolvedValue({ userId: 'u1', freeTripClaimed: false });
  mockedClaimFreeTrip.mockResolvedValue(TRIP);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('POST /v1/users/trip/claim-free — freeTrip flag', () => {
  it('pre-header build + enabled: claims exactly as before', async () => {
    flagsDoc({ freeTrip: { enabled: true, minAppVersion: '1.1.0' } });
    const res = await handler(claimEvent(null));
    expect(res.statusCode).toBe(200);
    expect(mockedClaimFreeTrip).toHaveBeenCalledWith('u1', 'apple-sub-1', TRIP.tripStart, TRIP.tripEnd);
  });

  it('pre-header build + disabled: 403 with a message pointing at Skip', async () => {
    flagsDoc({ freeTrip: { enabled: false } });
    const res = await handler(claimEvent(null));
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('FEATURE_DISABLED');
    expect(body.message).toMatch(/Skip/);
    expect(mockedClaimFreeTrip).not.toHaveBeenCalled();
  });

  it('versioned build below minAppVersion: 403', async () => {
    flagsDoc({ freeTrip: { enabled: true, minAppVersion: '1.2.0' } });
    const res = await handler(claimEvent('1.1.0'));
    expect(res.statusCode).toBe(403);
    expect(mockedClaimFreeTrip).not.toHaveBeenCalled();
  });

  it('missing flags doc: 403 (fail closed)', async () => {
    flagsDoc(null);
    const res = await handler(claimEvent('1.1.0'));
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /v1/flags', () => {
  it('returns evaluated booleans without requiring a Firebase token', async () => {
    flagsDoc({ freeTrip: { enabled: true, minAppVersion: '1.1.0' } });
    const res = await handler(flagsEvent('1.1.0'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ flags: { freeTrip: true } });
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('returns false for a build below minAppVersion', async () => {
    flagsDoc({ freeTrip: { enabled: true, minAppVersion: '1.2.0' } });
    const res = await handler(flagsEvent('1.1.0'));
    expect(JSON.parse(res.body)).toEqual({ flags: { freeTrip: false } });
  });

  it('still requires the API key', async () => {
    const event = flagsEvent('1.1.0');
    delete event.headers['x-api-key'];
    const res = await handler(event);
    expect(res.statusCode).toBe(401);
  });
});
