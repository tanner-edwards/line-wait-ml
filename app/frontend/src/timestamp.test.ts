import { formatHHMM, olderLastUpdated } from './timestamp';
import { CombinedResponse } from './types';

describe('olderLastUpdated', () => {
  it('returns the older of two park timestamps', () => {
    const resp: CombinedResponse = {
      parks: [
        { park: 'Disneyland', lastUpdated: '2026-05-15T20:05:00Z', rides: [] },
        { park: 'Disney California Adventure', lastUpdated: '2026-05-15T20:00:00Z', rides: [] },
      ],
    };
    expect(olderLastUpdated(resp)).toBe('2026-05-15T20:00:00Z');
  });

  it('returns the only successful park\'s timestamp when the other errored', () => {
    const resp: CombinedResponse = {
      parks: [
        { park: 'Disneyland', lastUpdated: '2026-05-15T20:05:00Z', rides: [] },
        {
          park: 'Disney California Adventure',
          lastUpdated: null,
          rides: [],
          error: 'UPSTREAM_UNAVAILABLE',
        },
      ],
    };
    expect(olderLastUpdated(resp)).toBe('2026-05-15T20:05:00Z');
  });

  it('returns null when every park errored', () => {
    const resp: CombinedResponse = {
      parks: [
        { park: 'Disneyland', lastUpdated: null, rides: [], error: 'UPSTREAM_UNAVAILABLE' },
        {
          park: 'Disney California Adventure',
          lastUpdated: null,
          rides: [],
          error: 'UPSTREAM_UNAVAILABLE',
        },
      ],
    };
    expect(olderLastUpdated(resp)).toBeNull();
  });
});

describe('formatHHMM', () => {
  it('formats a valid ISO timestamp as HH:MM', () => {
    // Just assert the shape — actual hours/minutes depend on the test runner's timezone.
    expect(formatHHMM('2026-05-15T20:00:00Z')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns "—" for null input', () => {
    expect(formatHHMM(null)).toBe('—');
  });

  it('returns "—" for an unparseable string', () => {
    expect(formatHHMM('not-a-date')).toBe('—');
  });
});
