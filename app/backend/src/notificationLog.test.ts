// Unit tests for the notification history read path. These exercise
// loadDeviceNotifications' real internals — the endpoint tests in
// devices/handler.test.ts mock this module wholesale, so without these the
// query shape and delivery filter have no coverage at all.

const mockGet = jest.fn();
const mockLimit = jest.fn(() => ({ get: mockGet }));
const mockOrderBy = jest.fn(() => ({ limit: mockLimit }));
const mockWhereFiredAt = jest.fn(() => ({ orderBy: mockOrderBy }));
const mockWhereDeviceId = jest.fn(() => ({ where: mockWhereFiredAt }));
const mockCollection = jest.fn(() => ({ where: mockWhereDeviceId }));

jest.mock('./firestoreClient', () => ({
  getFirestore: jest.fn(() => ({ collection: mockCollection })),
}));

import { loadDeviceNotifications, NotificationLogEntry } from './notificationLog';

// Minimal valid entry; individual tests override what they care about.
function entry(over: Partial<NotificationLogEntry> = {}): NotificationLogEntry {
  return {
    deviceId: 'dev-1',
    rideId: 'ride-1',
    rideName: 'Space Mountain',
    type: 'trough',
    badge: 'star',
    firedAt: '2026-09-10T18:00:00.000Z',
    expiresAt: '2026-09-11T18:00:00.000Z',
    currentWait: 10,
    delivered: true,
    deliveryError: null,
    ...over,
  };
}

function resolveWith(entries: NotificationLogEntry[]): void {
  mockGet.mockResolvedValue({
    forEach: (fn: (doc: { data: () => NotificationLogEntry }) => void) =>
      entries.forEach(e => fn({ data: () => e })),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadDeviceNotifications', () => {
  // The collection is append-only and never pruned in code, so an unbounded
  // read would bill a doc for every notification the device has ever had.
  it('filters, orders, and limits server-side rather than in memory', async () => {
    resolveWith([]);
    const now = new Date('2026-09-10T18:00:00.000Z');
    await loadDeviceNotifications('dev-1', 2 * 60 * 60 * 1000, now);

    expect(mockCollection).toHaveBeenCalledWith('notification_log');
    expect(mockWhereDeviceId).toHaveBeenCalledWith('deviceId', '==', 'dev-1');
    // 2 hours before `now`.
    expect(mockWhereFiredAt).toHaveBeenCalledWith('firedAt', '>=', '2026-09-10T16:00:00.000Z');
    expect(mockOrderBy).toHaveBeenCalledWith('firedAt', 'desc');
    expect(mockLimit).toHaveBeenCalled();
  });

  it('returns entries for the device', async () => {
    resolveWith([entry({ rideName: 'Space Mountain' }), entry({ rideName: 'Grizzly River Run' })]);
    const result = await loadDeviceNotifications('dev-1');
    expect(result.map(e => e.rideName)).toEqual(['Space Mountain', 'Grizzly River Run']);
  });

  // A failed push is still logged so the deliveryError is recoverable, but
  // the user should not see history for a notification they never got.
  it('omits entries whose push failed to deliver', async () => {
    resolveWith([
      entry({ rideName: 'Delivered', delivered: true }),
      entry({ rideName: 'Failed', delivered: false, deliveryError: '410: gone' }),
    ]);
    const result = await loadDeviceNotifications('dev-1');
    expect(result.map(e => e.rideName)).toEqual(['Delivered']);
  });

  // Entries written before `delivered` existed have no such field; dropping
  // them would silently erase older history.
  it('keeps legacy entries that predate the delivered field', async () => {
    const legacy = entry({ rideName: 'Legacy' });
    delete (legacy as Partial<NotificationLogEntry>).delivered;
    resolveWith([legacy]);
    const result = await loadDeviceNotifications('dev-1');
    expect(result.map(e => e.rideName)).toEqual(['Legacy']);
  });

  // 'peak' fires in scanner.js and must survive the read path — the entry
  // type omitted it until 2026-09-10.
  it('passes through peak notifications', async () => {
    resolveWith([entry({ type: 'peak', badge: null, rideName: "Peter Pan's Flight" })]);
    const result = await loadDeviceNotifications('dev-1');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('peak');
  });
});
