// Unit tests for loadPredictions' stale/degraded filtering. A ride whose doc is
// dropped here falls through to prediction: null and the historical-average
// Full Day curve in the handler, exactly like a ride with no doc at all.

const mockGet = jest.fn();
const mockCollection = jest.fn(() => ({ get: mockGet }));

jest.mock('./firestoreClient', () => ({
  getFirestore: jest.fn(() => ({ collection: mockCollection })),
}));

import { isUsablePrediction, loadPredictions, PREDICTION_MAX_AGE_MINUTES } from './mlPredictions';

const NOW = new Date('2026-10-14T19:00:00.000Z');

function minutesAgo(m: number): string {
  return new Date(NOW.getTime() - m * 60_000).toISOString();
}

// Minimal fields a doc needs to pass isUsablePrediction.
const USABLE = { t30: 40, trend: 'stable', confidence: 'high', full_day: [] };

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
      { id: 'fresh', data: { ride_id: 'fresh', updated_at: minutesAgo(5), ...USABLE } },
      {
        id: 'tombstone',
        data: { ride_id: 'tombstone', updated_at: minutesAgo(5), degraded: true, degraded_reason: 'insufficient_history' },
      },
      { id: 'stale', data: { ride_id: 'stale', updated_at: minutesAgo(25), ...USABLE } },
      { id: 'no-timestamp', data: { ride_id: 'no-timestamp', ...USABLE } },
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
      { id: 'edge', data: { ride_id: 'edge', updated_at: minutesAgo(PREDICTION_MAX_AGE_MINUTES), ...USABLE } },
    ]));
    expect([...(await loadPredictions(NOW)).keys()]).toEqual(['edge']);
  });
});

describe('loadPredictions — tombstone shapes', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('skips an old-style bare tombstone as unusable even without degraded', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGet.mockResolvedValue(snapshot([
      // The 2026-10-16 shape, minus the degraded flag: no t*, no full_day.
      { id: 'bare', data: { ride_id: 'bare', updated_at: minutesAgo(5), degraded_reason: 'insufficient_history' } },
      { id: 'healthy', data: { ride_id: 'healthy', updated_at: minutesAgo(5), ...USABLE } },
    ]));
    expect([...(await loadPredictions(NOW)).keys()]).toEqual(['healthy']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('predictions/bare'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing t30'));
    warn.mockRestore();
  });

  it('skips a full-shape tombstone via the degraded rule', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGet.mockResolvedValue(snapshot([
      {
        id: 'tomb',
        data: {
          ride_id: 'tomb', updated_at: minutesAgo(5),
          t10: 35, t20: 35, t30: 35, t40: 35, t50: 35, t60: 35,
          t90: 35, t120: 35, t150: 35, t180: 35, t210: 35, t240: 35,
          trend: 'stable', trend_delta_30: 0, confidence: 'low', full_day: [],
          degraded: true, degraded_reason: 'insufficient_history', model_version: '2026-10-04',
        },
      },
    ]));
    expect((await loadPredictions(NOW)).size).toBe(0);
    // Dropped by `degraded`, not by the usability check.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('isUsablePrediction', () => {
  it('accepts a doc with the required fields', () => {
    expect(isUsablePrediction(USABLE)).toBe(true);
  });

  it.each([
    ['t30', { ...USABLE, t30: undefined }],
    ['trend', { ...USABLE, trend: undefined }],
    ['confidence', { ...USABLE, confidence: undefined }],
    ['full_day', { ...USABLE, full_day: undefined }],
    ['full_day (not an array)', { ...USABLE, full_day: {} }],
  ])('rejects a doc missing %s', (_label, doc) => {
    expect(isUsablePrediction(doc)).toBe(false);
  });

  it('rejects null and non-objects', () => {
    expect(isUsablePrediction(null)).toBe(false);
    expect(isUsablePrediction('x')).toBe(false);
  });
});
