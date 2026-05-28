import { shapeCombined, shapeParkData, shapeParkError } from './responseShape';
import { Ride } from './types';

describe('shapeParkData', () => {
  it('returns the per-park shape with the park\'s display name', () => {
    const rides: Ride[] = [
      {
        id: '1',
        name: 'Space Mountain',
        land: 'Tomorrowland',
        status: 'OPERATING',
        currentWait: 55,
        historicalAverage: null,
        rideStats: null,
        prediction: null,
        recentHistory: null,
      },
    ];

    const result = shapeParkData('disneyland', rides, '2026-05-15T20:00:00Z');

    expect(result).toEqual({
      park: 'Disneyland',
      lastUpdated: '2026-05-15T20:00:00Z',
      rides,
    });
  });

  it('uses the Disney California Adventure display name for the california-adventure slug', () => {
    const result = shapeParkData('california-adventure', [], '2026-05-15T20:00:00Z');
    expect(result.park).toBe('Disney California Adventure');
  });
});

describe('shapeParkError', () => {
  it('returns the per-park error shape with rides empty, lastUpdated null, and the given error code', () => {
    const result = shapeParkError('disneyland', 'UPSTREAM_UNAVAILABLE');

    expect(result).toEqual({
      park: 'Disneyland',
      lastUpdated: null,
      rides: [],
      error: 'UPSTREAM_UNAVAILABLE',
    });
  });
});

describe('shapeCombined', () => {
  it('wraps a list of per-park entries into the combined response shape', () => {
    const entries = [
      shapeParkData('disneyland', [], '2026-05-15T20:00:00Z'),
      shapeParkError('california-adventure', 'UPSTREAM_UNAVAILABLE'),
    ];

    const result = shapeCombined(entries);

    expect(result).toEqual({ parks: entries });
  });
});
