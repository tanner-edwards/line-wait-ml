import { fetchRecentHistory } from './recentHistory';
import * as firestoreClient from './firestoreClient';

jest.mock('./firestoreClient');

const mockedGetFirestore = firestoreClient.getFirestore as jest.MockedFunction<typeof firestoreClient.getFirestore>;

function makeTimestamp(date: Date) {
  return { toDate: () => date };
}

function makeSnap(docs: object[]) {
  return {
    forEach: (cb: (doc: { data: () => object }) => void) => {
      docs.forEach(d => cb({ data: () => d }));
    },
  };
}

function buildMockDb(snap: object) {
  const getMock = jest.fn().mockResolvedValue(snap);
  const orderByMock = jest.fn().mockReturnValue({ get: getMock });
  const whereMock3 = jest.fn().mockReturnValue({ orderBy: orderByMock });
  const whereMock2 = jest.fn().mockReturnValue({ where: whereMock3 });
  const whereMock1 = jest.fn().mockReturnValue({ where: whereMock2 });
  const collectionMock = jest.fn().mockReturnValue({ where: whereMock1 });
  return { collection: collectionMock };
}

const REFERENCE_DATE = new Date('2026-05-22T01:00:00Z');
const T_MINUS_20 = new Date('2026-05-22T00:40:00Z');  // 20 min before ref
const T_MINUS_35 = new Date('2026-05-22T00:25:00Z');  // 35 min before ref

const RIDE_A = 'ride-a-uuid';
const RIDE_B = 'ride-b-uuid';

describe('fetchRecentHistory', () => {
  it('returns a map with up to 2 snapshots per ride, most recent first', async () => {
    const snap = makeSnap([
      { ride_id: RIDE_A, wait_minutes: 25, status: 'OPERATING', timestamp_utc: makeTimestamp(T_MINUS_20) },
      { ride_id: RIDE_A, wait_minutes: 30, status: 'OPERATING', timestamp_utc: makeTimestamp(T_MINUS_35) },
    ]);
    mockedGetFirestore.mockReturnValue(buildMockDb(snap) as any);

    const map = await fetchRecentHistory('disneyland', REFERENCE_DATE);
    const history = map.get(RIDE_A)!;
    expect(history).toHaveLength(2);
    expect(history[0].wait).toBe(25);
    expect(history[1].wait).toBe(30);
  });

  it('caps at 2 entries per ride even when the query returns more docs', async () => {
    const t3 = new Date('2026-05-22T00:15:00Z');
    const snap = makeSnap([
      { ride_id: RIDE_A, wait_minutes: 20, status: 'OPERATING', timestamp_utc: makeTimestamp(T_MINUS_20) },
      { ride_id: RIDE_A, wait_minutes: 25, status: 'OPERATING', timestamp_utc: makeTimestamp(T_MINUS_35) },
      { ride_id: RIDE_A, wait_minutes: 30, status: 'OPERATING', timestamp_utc: makeTimestamp(t3) },
    ]);
    mockedGetFirestore.mockReturnValue(buildMockDb(snap) as any);

    const map = await fetchRecentHistory('disneyland', REFERENCE_DATE);
    expect(map.get(RIDE_A)).toHaveLength(2);
  });

  it('handles multiple rides independently', async () => {
    const snap = makeSnap([
      { ride_id: RIDE_A, wait_minutes: 25, status: 'OPERATING', timestamp_utc: makeTimestamp(T_MINUS_20) },
      { ride_id: RIDE_B, wait_minutes: 10, status: 'OPERATING', timestamp_utc: makeTimestamp(T_MINUS_20) },
    ]);
    mockedGetFirestore.mockReturnValue(buildMockDb(snap) as any);

    const map = await fetchRecentHistory('disneyland', REFERENCE_DATE);
    expect(map.get(RIDE_A)![0].wait).toBe(25);
    expect(map.get(RIDE_B)![0].wait).toBe(10);
  });

  it('maps wait_minutes: null to RecentSnapshot.wait === null', async () => {
    const snap = makeSnap([
      { ride_id: RIDE_A, wait_minutes: null, status: 'CLOSED', timestamp_utc: makeTimestamp(T_MINUS_20) },
    ]);
    mockedGetFirestore.mockReturnValue(buildMockDb(snap) as any);

    const map = await fetchRecentHistory('disneyland', REFERENCE_DATE);
    expect(map.get(RIDE_A)![0].wait).toBeNull();
    expect(map.get(RIDE_A)![0].status).toBe('CLOSED');
  });

  it('computes minutesAgo from actual timestamp delta, not assumed 10-min interval', async () => {
    // T_MINUS_35 is 35 minutes before REFERENCE_DATE
    const snap = makeSnap([
      { ride_id: RIDE_A, wait_minutes: 30, status: 'OPERATING', timestamp_utc: makeTimestamp(T_MINUS_35) },
    ]);
    mockedGetFirestore.mockReturnValue(buildMockDb(snap) as any);

    const map = await fetchRecentHistory('disneyland', REFERENCE_DATE);
    expect(map.get(RIDE_A)![0].minutesAgo).toBe(35);
  });

  it('returns an empty map when Firestore throws, without rethrowing', async () => {
    const badDb = { collection: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              get: jest.fn().mockRejectedValue(new Error('index not ready')),
            }),
          }),
        }),
      }),
    })};
    mockedGetFirestore.mockReturnValue(badDb as any);

    const map = await fetchRecentHistory('disneyland', REFERENCE_DATE);
    expect(map.size).toBe(0);
  });

  it('stores the ISO timestamp string on each snapshot', async () => {
    const snap = makeSnap([
      { ride_id: RIDE_A, wait_minutes: 25, status: 'OPERATING', timestamp_utc: makeTimestamp(T_MINUS_20) },
    ]);
    mockedGetFirestore.mockReturnValue(buildMockDb(snap) as any);

    const map = await fetchRecentHistory('disneyland', REFERENCE_DATE);
    expect(map.get(RIDE_A)![0].timestamp).toBe(T_MINUS_20.toISOString());
  });
});
