// Endpoint-level tests for POST /v1/feedback. Firestore writes/reads are
// mocked at the module boundary so these tests stay fast and don't need
// Firebase credentials.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { _resetCacheForTests, handler } from './handler';

jest.mock('./feedback', () => {
  const actual = jest.requireActual<typeof import('./feedback')>('./feedback');
  return {
    ...actual,
    submitFeedback: jest.fn().mockResolvedValue(undefined),
  };
});

// Auth verification dynamically imports these two — mock them so we control
// the uid returned by verifyAuth without needing real Firebase credentials.
jest.mock('./firestoreClient', () => ({ initFirebase: jest.fn(() => ({})) }));
const mockVerifyIdToken = jest.fn();
jest.mock('firebase-admin', () => ({ auth: jest.fn(() => ({ verifyIdToken: mockVerifyIdToken })) }));

jest.mock('./users', () => {
  const actual = jest.requireActual<typeof import('./users')>('./users');
  return { ...actual, getTrip: jest.fn() };
});

// Recent-history fetcher hits Firestore on cold start; stub it out so these
// tests don't accidentally trigger live-data network paths.
jest.mock('./recentHistory', () => ({
  fetchRecentHistory: jest.fn().mockResolvedValue(new Map()),
  _resetForTests: jest.fn(),
}));

jest.mock('./notificationLog', () => ({
  loadDeviceNotifications: jest.fn().mockResolvedValue([]),
}));

import * as feedbackModule from './feedback';
const mockedFeedback = feedbackModule as jest.Mocked<typeof feedbackModule>;

import * as usersModule from './users';
const mockedGetTrip = usersModule.getTrip as jest.Mock;

function buildEvent(
  body: object | string | null = null,
  apiKey: string | null = 'test-api-key',
  authToken: string | null = 'valid-token'
): APIGatewayProxyEvent {
  const headers: Record<string, string> = {};
  if (apiKey !== null) headers['x-api-key'] = apiKey;
  if (authToken !== null) headers['authorization'] = `Bearer ${authToken}`;
  return {
    path: '/v1/feedback',
    httpMethod: 'POST',
    headers,
    body: body === null ? null : typeof body === 'string' ? body : JSON.stringify(body),
  } as unknown as APIGatewayProxyEvent;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetCacheForTests();
  process.env.API_KEY = 'test-api-key';
  process.env.CORS_ORIGIN = '*';
  mockVerifyIdToken.mockResolvedValue({ uid: 'u1', firebase: { sign_in_provider: 'apple.com' } });
});

describe('POST /v1/feedback', () => {
  it('submits feedback with all fields answered, using the resolved tripId', async () => {
    mockedGetTrip.mockResolvedValue({
      id: 'trip-1', uid: 'u1', tripStart: '2026-08-10', tripEnd: '2026-08-14',
      purchasedAt: '2026-08-01T00:00:00Z', source: 'iap',
    });

    const res = await handler(
      buildEvent({
        predictionTrust: 4,
        predictionTrustNote: 'usually right',
        clarity: 5,
        clarityNote: null,
        usability: 3,
        usabilityNote: 'a bit clunky',
        outcomeImpact: 4,
        outcomeImpactNote: null,
        repeatIntent: 5,
        repeatIntentNote: null,
        overallFreeText: 'great app',
      })
    );

    expect(res.statusCode).toBe(200);
    expect(mockedFeedback.submitFeedback).toHaveBeenCalledWith('u1', {
      tripId: 'trip-1',
      predictionTrust: 4,
      predictionTrustNote: 'usually right',
      clarity: 5,
      clarityNote: null,
      usability: 3,
      usabilityNote: 'a bit clunky',
      outcomeImpact: 4,
      outcomeImpactNote: null,
      repeatIntent: 5,
      repeatIntentNote: null,
      overallFreeText: 'great app',
    });
  });

  it('accepts a fully blank submission — all optional fields null', async () => {
    mockedGetTrip.mockResolvedValue(null);

    const res = await handler(buildEvent({}));

    expect(res.statusCode).toBe(200);
    expect(mockedFeedback.submitFeedback).toHaveBeenCalledWith('u1', {
      tripId: null,
      predictionTrust: null,
      predictionTrustNote: null,
      clarity: null,
      clarityNote: null,
      usability: null,
      usabilityNote: null,
      outcomeImpact: null,
      outcomeImpactNote: null,
      repeatIntent: null,
      repeatIntentNote: null,
      overallFreeText: null,
    });
  });

  it('stores tripId: null when the user has no active/recent trip', async () => {
    mockedGetTrip.mockResolvedValue(null);

    const res = await handler(buildEvent({ clarity: 3 }));

    expect(res.statusCode).toBe(200);
    expect(mockedFeedback.submitFeedback).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ tripId: null })
    );
  });

  it('rejects an out-of-range rating with 400', async () => {
    const res = await handler(buildEvent({ clarity: 6 }));

    expect(res.statusCode).toBe(400);
    expect(mockedFeedback.submitFeedback).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric rating with 400', async () => {
    const res = await handler(buildEvent({ clarity: 'high' }));

    expect(res.statusCode).toBe(400);
    expect(mockedFeedback.submitFeedback).not.toHaveBeenCalled();
  });

  it('rejects a missing/invalid auth token with 401', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid token'));

    const res = await handler(buildEvent({}, 'test-api-key', 'bad-token'));

    expect(res.statusCode).toBe(401);
    expect(mockedFeedback.submitFeedback).not.toHaveBeenCalled();
  });

  it('rejects a missing API key with 401', async () => {
    const res = await handler(buildEvent({}, null));

    expect(res.statusCode).toBe(401);
    expect(mockedFeedback.submitFeedback).not.toHaveBeenCalled();
  });
});
