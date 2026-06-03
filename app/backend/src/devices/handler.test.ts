// Endpoint-level tests for the three /v1/devices/* routes. The actual
// Firestore writes are mocked at the module boundary so these tests stay
// fast and don't need Firebase credentials.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { _resetCacheForTests, handler } from '../handler';

jest.mock('./devices', () => {
  const actual = jest.requireActual<typeof import('./devices')>('./devices');
  return {
    ...actual,
    upsertDevice: jest.fn().mockResolvedValue(undefined),
    setArmedDate: jest.fn().mockResolvedValue(undefined),
    setMustDoRideIds: jest.fn().mockResolvedValue(undefined),
    setDailyParks: jest.fn().mockResolvedValue(undefined),
    setNotificationTypes: jest.fn().mockResolvedValue(undefined),
    // todayInPT stays real so tests assert on a stable date format.
  };
});

// Recent-history fetcher hits Firestore on cold start; stub it out so
// /v1/devices/* tests don't accidentally trigger live-data network paths.
jest.mock('../recentHistory', () => ({
  fetchRecentHistory: jest.fn().mockResolvedValue(new Map()),
  _resetForTests: jest.fn(),
}));

// notification_log read for GET /v1/devices/:id/notifications.
jest.mock('../notificationLog', () => ({
  loadDeviceNotifications: jest.fn().mockResolvedValue([]),
}));
import * as notifLogModule from '../notificationLog';
const mockedNotifLog = notifLogModule as jest.Mocked<typeof notifLogModule>;

import * as devicesModule from './devices';
const mockedDevices = devicesModule as jest.Mocked<typeof devicesModule>;

function buildEvent(
  path: string,
  method: string,
  body: object | string | null = null,
  apiKey: string | null = 'test-api-key'
): APIGatewayProxyEvent {
  const headers = apiKey === null ? {} : { 'x-api-key': apiKey };
  return {
    path,
    httpMethod: method,
    headers,
    body: body === null ? null : typeof body === 'string' ? body : JSON.stringify(body),
  } as unknown as APIGatewayProxyEvent;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetCacheForTests();
  process.env.API_KEY = 'test-api-key';
  process.env.CORS_ORIGIN = '*';
});

describe('POST /v1/devices (register/upsert)', () => {
  it('upserts a device with a valid body', async () => {
    const res = await handler(
      buildEvent('/v1/devices', 'POST', {
        deviceId: 'abc-123',
        pushToken: 'web-push-sub-json',
        pushTokenType: 'web',
        mustDoRideIds: ['ride-1', 'ride-2'],
        notificationsEnabled: true,
      })
    );
    expect(res.statusCode).toBe(200);
    expect(mockedDevices.upsertDevice).toHaveBeenCalledWith('abc-123', {
      pushToken: 'web-push-sub-json',
      pushTokenType: 'web',
      mustDoRideIds: ['ride-1', 'ride-2'],
      notificationsEnabled: true,
    });
  });

  it('accepts null pushToken (notifications disabled)', async () => {
    const res = await handler(
      buildEvent('/v1/devices', 'POST', {
        deviceId: 'abc-123',
        pushToken: null,
        pushTokenType: null,
        notificationsEnabled: false,
      })
    );
    expect(res.statusCode).toBe(200);
    expect(mockedDevices.upsertDevice).toHaveBeenCalled();
  });

  it('rejects missing deviceId', async () => {
    const res = await handler(buildEvent('/v1/devices', 'POST', { pushToken: 'x' }));
    expect(res.statusCode).toBe(400);
    expect(mockedDevices.upsertDevice).not.toHaveBeenCalled();
  });

  it('rejects empty deviceId', async () => {
    const res = await handler(buildEvent('/v1/devices', 'POST', { deviceId: '' }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid pushTokenType', async () => {
    const res = await handler(
      buildEvent('/v1/devices', 'POST', {
        deviceId: 'abc',
        pushToken: 'x',
        pushTokenType: 'firebase',
      })
    );
    expect(res.statusCode).toBe(400);
  });

  it('filters non-string entries out of mustDoRideIds', async () => {
    const res = await handler(
      buildEvent('/v1/devices', 'POST', {
        deviceId: 'abc',
        pushToken: null,
        mustDoRideIds: ['ride-1', 42, '', 'ride-2'],
      })
    );
    expect(res.statusCode).toBe(200);
    expect(mockedDevices.upsertDevice).toHaveBeenCalledWith('abc', expect.objectContaining({
      mustDoRideIds: ['ride-1', 'ride-2'],
    }));
  });

  it('rejects non-JSON body', async () => {
    const res = await handler(buildEvent('/v1/devices', 'POST', 'not json'));
    expect(res.statusCode).toBe(400);
  });

  it('requires API key', async () => {
    const res = await handler(buildEvent('/v1/devices', 'POST', { deviceId: 'abc' }, null));
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/devices/:id/arm', () => {
  it("stamps the device with today's PT date", async () => {
    const res = await handler(buildEvent('/v1/devices/abc-123/arm', 'POST'));
    expect(res.statusCode).toBe(200);
    expect(mockedDevices.setArmedDate).toHaveBeenCalledTimes(1);
    const [deviceId, date] = mockedDevices.setArmedDate.mock.calls[0];
    expect(deviceId).toBe('abc-123');
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the stamped date in the response', async () => {
    const res = await handler(buildEvent('/v1/devices/abc-123/arm', 'POST'));
    const body = JSON.parse(res.body);
    expect(body.deviceId).toBe('abc-123');
    expect(body.armedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('handles device IDs with dashes and uuids', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const res = await handler(buildEvent(`/v1/devices/${uuid}/arm`, 'POST'));
    expect(res.statusCode).toBe(200);
    expect(mockedDevices.setArmedDate.mock.calls[0][0]).toBe(uuid);
  });
});

describe('POST /v1/devices/:id/must-do', () => {
  it('updates the must-do list', async () => {
    const res = await handler(
      buildEvent('/v1/devices/abc-123/must-do', 'POST', {
        mustDoRideIds: ['ride-1', 'ride-2'],
      })
    );
    expect(res.statusCode).toBe(200);
    expect(mockedDevices.setMustDoRideIds).toHaveBeenCalledWith('abc-123', ['ride-1', 'ride-2']);
  });

  it('accepts an empty list', async () => {
    const res = await handler(
      buildEvent('/v1/devices/abc-123/must-do', 'POST', { mustDoRideIds: [] })
    );
    expect(res.statusCode).toBe(200);
    expect(mockedDevices.setMustDoRideIds).toHaveBeenCalledWith('abc-123', []);
  });

  it('rejects missing array', async () => {
    const res = await handler(buildEvent('/v1/devices/abc-123/must-do', 'POST', {}));
    expect(res.statusCode).toBe(400);
    expect(mockedDevices.setMustDoRideIds).not.toHaveBeenCalled();
  });

  it('rejects non-array', async () => {
    const res = await handler(
      buildEvent('/v1/devices/abc-123/must-do', 'POST', { mustDoRideIds: 'ride-1' })
    );
    expect(res.statusCode).toBe(400);
  });

  it('filters non-strings out of the array', async () => {
    const res = await handler(
      buildEvent('/v1/devices/abc-123/must-do', 'POST', {
        mustDoRideIds: ['ride-1', 42, '', null, 'ride-2'],
      })
    );
    expect(res.statusCode).toBe(200);
    expect(mockedDevices.setMustDoRideIds).toHaveBeenCalledWith('abc-123', ['ride-1', 'ride-2']);
  });
});

describe('POST /v1/devices/:id/daily-parks', () => {
  it('accepts each valid value', async () => {
    for (const v of ['disneyland', 'california-adventure', 'both']) {
      const res = await handler(
        buildEvent('/v1/devices/abc-123/daily-parks', 'POST', { dailyParks: v })
      );
      expect(res.statusCode).toBe(200);
      expect(mockedDevices.setDailyParks).toHaveBeenLastCalledWith('abc-123', v);
    }
  });

  it('rejects missing dailyParks', async () => {
    const res = await handler(buildEvent('/v1/devices/abc-123/daily-parks', 'POST', {}));
    expect(res.statusCode).toBe(400);
    expect(mockedDevices.setDailyParks).not.toHaveBeenCalled();
  });

  it('rejects invalid value', async () => {
    const res = await handler(
      buildEvent('/v1/devices/abc-123/daily-parks', 'POST', { dailyParks: 'magic-kingdom' })
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/devices/:id/notification-types', () => {
  it('accepts all four booleans', async () => {
    const res = await handler(
      buildEvent('/v1/devices/abc-123/notification-types', 'POST', {
        trough: true, closure: false, reopen: true, peak: false,
      })
    );
    expect(res.statusCode).toBe(200);
    expect(mockedDevices.setNotificationTypes).toHaveBeenCalledWith('abc-123', {
      trough: true, closure: false, reopen: true, peak: false,
    });
  });

  it('rejects missing field', async () => {
    const res = await handler(
      buildEvent('/v1/devices/abc-123/notification-types', 'POST', { trough: true, closure: false, reopen: true })
    );
    expect(res.statusCode).toBe(400);
    expect(mockedDevices.setNotificationTypes).not.toHaveBeenCalled();
  });

  it('rejects non-boolean values', async () => {
    const res = await handler(
      buildEvent('/v1/devices/abc-123/notification-types', 'POST', {
        trough: 'yes', closure: false, reopen: true,
      })
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/devices/:id/notifications', () => {
  it('returns the entries from notification_log for the device', async () => {
    const entries = [
      {
        deviceId: 'abc-123', rideId: 'r1', rideName: 'Pirates',
        type: 'trough' as const, badge: 'go' as const,
        firedAt: '2026-06-01T18:30:00Z', expiresAt: '2026-06-02T18:30:00Z',
        currentWait: 25, delivered: true, deliveryError: null,
      },
    ];
    mockedNotifLog.loadDeviceNotifications.mockResolvedValueOnce(entries);
    const res = await handler(buildEvent('/v1/devices/abc-123/notifications', 'GET'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.deviceId).toBe('abc-123');
    expect(body.notifications).toEqual(entries);
    expect(mockedNotifLog.loadDeviceNotifications).toHaveBeenCalledWith('abc-123');
  });

  it('returns an empty list when no recent notifications', async () => {
    mockedNotifLog.loadDeviceNotifications.mockResolvedValueOnce([]);
    const res = await handler(buildEvent('/v1/devices/abc-123/notifications', 'GET'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).notifications).toEqual([]);
  });

  it('requires API key', async () => {
    const res = await handler(buildEvent('/v1/devices/abc-123/notifications', 'GET', null, null));
    expect(res.statusCode).toBe(401);
  });
});

describe('routing edge cases', () => {
  it('returns 404 for /v1/devices via GET (no GET route registered)', async () => {
    const res = await handler(buildEvent('/v1/devices', 'GET'));
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for an unknown subpath', async () => {
    const res = await handler(buildEvent('/v1/devices/abc/unknown-action', 'POST'));
    expect(res.statusCode).toBe(404);
  });
});
