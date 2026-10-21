import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockGet = jest.fn();
jest.mock('./firestoreClient', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({ doc: jest.fn(() => ({ get: mockGet })) })),
  })),
}));

import {
  _resetForTests,
  compareVersions,
  evaluateFlags,
  getAppVersion,
  isFlagEnabled,
} from './featureFlags';

function docWith(data: object | null): void {
  mockGet.mockResolvedValue({ exists: data !== null, data: () => data });
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions([1, 10, 0], [1, 9, 0])).toBeGreaterThan(0);
    expect(compareVersions([1, 0, 0], [1, 1, 0])).toBeLessThan(0);
  });

  it('treats missing parts as 0', () => {
    expect(compareVersions([1, 1], [1, 1, 0])).toBe(0);
  });
});

describe('getAppVersion', () => {
  it('reads x-app-version in either casing', () => {
    expect(getAppVersion({ headers: { 'x-app-version': '1.1.0' } } as unknown as APIGatewayProxyEvent)).toBe('1.1.0');
    expect(getAppVersion({ headers: { 'X-App-Version': '1.1.0' } } as unknown as APIGatewayProxyEvent)).toBe('1.1.0');
  });

  it('returns null when absent or blank', () => {
    expect(getAppVersion({ headers: {} } as unknown as APIGatewayProxyEvent)).toBeNull();
    expect(getAppVersion({ headers: { 'x-app-version': '  ' } } as unknown as APIGatewayProxyEvent)).toBeNull();
    expect(getAppVersion({} as unknown as APIGatewayProxyEvent)).toBeNull();
  });
});

describe('isFlagEnabled', () => {
  it('is off when the doc is missing', async () => {
    docWith(null);
    expect(await isFlagEnabled('freeTrip', '1.1.0')).toBe(false);
    expect(await isFlagEnabled('freeTrip', null)).toBe(false);
  });

  it('is off when Firestore errors', async () => {
    mockGet.mockRejectedValue(new Error('unavailable'));
    expect(await isFlagEnabled('freeTrip', '1.1.0')).toBe(false);
  });

  it('is off when the flag is absent or not strictly true', async () => {
    docWith({ freeTrip: { enabled: 'true' } });
    expect(await isFlagEnabled('freeTrip', '1.1.0')).toBe(false);
  });

  it('is on when enabled with no minAppVersion', async () => {
    docWith({ freeTrip: { enabled: true } });
    expect(await isFlagEnabled('freeTrip', '1.0.0')).toBe(true);
  });

  it('applies minAppVersion when the header is present', async () => {
    docWith({ freeTrip: { enabled: true, minAppVersion: '1.1.0' } });
    expect(await isFlagEnabled('freeTrip', '1.0.9')).toBe(false);
    expect(await isFlagEnabled('freeTrip', '1.1.0')).toBe(true);
    expect(await isFlagEnabled('freeTrip', '1.2.0')).toBe(true);
  });

  it('ignores minAppVersion for pre-header builds (no version) and uses enabled only', async () => {
    docWith({ freeTrip: { enabled: true, minAppVersion: '9.0.0' } });
    expect(await isFlagEnabled('freeTrip', null)).toBe(true);

    _resetForTests();
    docWith({ freeTrip: { enabled: false } });
    expect(await isFlagEnabled('freeTrip', null)).toBe(false);
  });

  it('is off for a malformed app version or a malformed minAppVersion', async () => {
    docWith({ freeTrip: { enabled: true, minAppVersion: '1.1.0' } });
    expect(await isFlagEnabled('freeTrip', 'banana')).toBe(false);

    _resetForTests();
    docWith({ freeTrip: { enabled: true, minAppVersion: 'v1.1' } });
    expect(await isFlagEnabled('freeTrip', '2.0.0')).toBe(false);
  });

  it('caches the doc between calls', async () => {
    docWith({ freeTrip: { enabled: true } });
    await isFlagEnabled('freeTrip', null);
    await isFlagEnabled('freeTrip', '1.1.0');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('evaluateFlags', () => {
  it('returns every known flag, defaulting missing ones to false', async () => {
    docWith({});
    expect(await evaluateFlags('1.1.0')).toEqual({ freeTrip: false });
  });

  it('evaluates each flag for the caller version', async () => {
    docWith({ freeTrip: { enabled: true, minAppVersion: '1.1.0' } });
    expect(await evaluateFlags('1.1.0')).toEqual({ freeTrip: true });
  });
});
