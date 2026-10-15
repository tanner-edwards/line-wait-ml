// Unit tests for loadPredictions' stale/degraded filtering. A ride whose doc is
// dropped here falls through to prediction: null and the historical-average
// Full Day curve in the handler, exactly like a ride with no doc at all.

const mockGet = jest.fn();
const mockCollection = jest.fn(() => ({ get: mockGet }));

jest.mock('./firestoreClient', () => ({
  getFirestore: jest.fn(() => ({ collection: mockCollection })),
}));

import { loadPredictions, PREDICTION_MAX_AGE_MINUTES } from './mlPredictions';

const NOW = new Date('2026-10-14T19:00:00.000Z');

function minutesAgo(m: number): string {
  return new Date(NOW.getTime() - m * 60_000).toISOString();
}

function snapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return { docs: docs.map(d => ({ id: d.id, data: () => d.data })) };
}

describe('loadPredictions — stale and degraded filtering', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockCollection.mockClear();
  });

  it('keeps only the fresh, non-degraded doc', async () => {
    mockGet.mockResolvedValue(snapshot([
      { id: 'fresh', data: { ride_id: 'fresh', updated_at: minutesAgo(5), t30: 40 } },
      {
        id: 'tombstone',
        data: { ride_id: 'tombstone', updated_at: minutesAgo(5), degraded: true, degraded_reason: 'insufficient_history' },
      },
      { id: 'stale', data: { ride_id: 'stale', updated_at: minutesAgo(25), t30: 40 } },
      { id: 'no-timestamp', data: { ride_id: 'no-timestamp', t30: 40 } },
    ]));

    const map = await loadPredictions(NOW);

    expect(mockCollection).toHaveBeenCalledWith('predictions');
    expect([...map.keys()]).toEqual(['fresh']);
  });

  it('drops a doc with an unparseable updated_at', async () => {
    mockGet.mockResolvedValue(snapshot([
      { id: 'garbage', data: { ride_id: 'garbage', updated_at: 'not-a-date' } },
    ]));
    expect((await loadPredictions(NOW)).size).toBe(0);
  });

  it('keeps a doc exactly at the max age', async () => {
    mockGet.mockResolvedValue(snapshot([
      { id: 'edge', data: { ride_id: 'edge', updated_at: minutesAgo(PREDICTION_MAX_AGE_MINUTES) } },
    ]));
    expect([...(await loadPredictions(NOW)).keys()]).toEqual(['edge']);
  });
});
