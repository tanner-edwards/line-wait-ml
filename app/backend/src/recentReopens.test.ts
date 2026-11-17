import { loadRecentReopens } from './recentReopens';
import * as firestoreClient from './firestoreClient';

jest.mock('./firestoreClient');

const mockedGetFirestore = firestoreClient.getFirestore as jest.MockedFunction<typeof firestoreClient.getFirestore>;

function makeSnap(docs: object[]) {
  return { forEach: (cb: (doc: { data: () => object }) => void) => docs.forEach(d => cb({ data: () => d })) };
}

function buildMockDb(get: jest.Mock) {
  const where = jest.fn().mockReturnValue({ get });
  const collection = jest.fn().mockReturnValue({ where });
  return { db: { collection }, collection, where };
}

const NOW = new Date('2026-11-14T21:30:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

describe('loadRecentReopens', () => {
  it('runs one single-field range query on reopenedAt for the last 60 minutes', async () => {
    const m = buildMockDb(jest.fn().mockResolvedValue(makeSnap([])));
    mockedGetFirestore.mockReturnValue(m.db as any);
    await loadRecentReopens(NOW);
    expect(m.collection).toHaveBeenCalledWith('closure_events');
    expect(m.where).toHaveBeenCalledTimes(1);
    expect(m.where).toHaveBeenCalledWith('reopenedAt', '>=', minsAgo(60));
  });

  it('maps rideId to whole minutes ago, keeping the newest per ride', async () => {
    const m = buildMockDb(jest.fn().mockResolvedValue(makeSnap([
      { rideId: 'space', reopenedAt: minsAgo(40) },
      { rideId: 'space', reopenedAt: minsAgo(20) },
      { rideId: 'space', reopenedAt: minsAgo(55) },
      { rideId: 'btm', reopenedAt: new Date(NOW.getTime() - 4.6 * 60_000).toISOString() },
    ])));
    mockedGetFirestore.mockReturnValue(m.db as any);
    const map = await loadRecentReopens(NOW);
    expect(map).toEqual(new Map([['space', 20], ['btm', 5]]));
  });

  it('ignores reopens after `now` (time-travel requests)', async () => {
    const m = buildMockDb(jest.fn().mockResolvedValue(makeSnap([
      { rideId: 'later', reopenedAt: minsAgo(-30) },
      { rideId: 'skew', reopenedAt: minsAgo(-0.5) },
      { rideId: 'earlier', reopenedAt: minsAgo(15) },
    ])));
    mockedGetFirestore.mockReturnValue(m.db as any);
    expect(await loadRecentReopens(NOW)).toEqual(new Map([['skew', 0], ['earlier', 15]]));
  });

  it('skips malformed docs', async () => {
    const m = buildMockDb(jest.fn().mockResolvedValue(makeSnap([
      { rideId: 'a', reopenedAt: 'not a date' },
      { reopenedAt: minsAgo(5) },
      { rideId: 'b' },
      { rideId: 'c', reopenedAt: minsAgo(10) },
    ])));
    mockedGetFirestore.mockReturnValue(m.db as any);
    expect(await loadRecentReopens(NOW)).toEqual(new Map([['c', 10]]));
  });

  it('returns an empty map when the query rejects', async () => {
    const m = buildMockDb(jest.fn().mockRejectedValue(new Error('quota')));
    mockedGetFirestore.mockReturnValue(m.db as any);
    expect(await loadRecentReopens(NOW)).toEqual(new Map());
  });

  it('returns an empty map when Firestore cannot initialize', async () => {
    mockedGetFirestore.mockImplementation(() => { throw new Error('no creds'); });
    expect(await loadRecentReopens(NOW)).toEqual(new Map());
  });
});
