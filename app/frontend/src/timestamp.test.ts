import { formatBucketTimeSlot, formatHHMM, olderLastUpdated } from './timestamp';
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
  it('formats a valid ISO timestamp in PT regardless of runner timezone', () => {
    // 2026-05-15T20:00:00Z = 1:00 PM PDT (UTC-7). Pin the exact value so a
    // runner in a non-PT timezone still produces a consistent PT label.
    expect(formatHHMM('2026-05-15T20:00:00Z')).toBe('1:00 PM');
  });

  it('returns "—" for null input', () => {
    expect(formatHHMM(null)).toBe('—');
  });

  it('returns "—" for an unparseable string', () => {
    expect(formatHHMM('not-a-date')).toBe('—');
  });
});

describe('formatBucketTimeSlot', () => {
  it('formats morning slots as AM', () => {
    expect(formatBucketTimeSlot('10:00-10:30')).toBe('10:00 AM');
    expect(formatBucketTimeSlot('10:30-11:00')).toBe('10:30 AM');
  });

  it('formats noon as 12 PM', () => {
    expect(formatBucketTimeSlot('12:00-12:30')).toBe('12:00 PM');
  });

  it('formats afternoon and evening slots as PM', () => {
    expect(formatBucketTimeSlot('13:30-14:00')).toBe('1:30 PM');
    expect(formatBucketTimeSlot('20:30-21:00')).toBe('8:30 PM');
  });

  it('formats midnight as 12 AM', () => {
    expect(formatBucketTimeSlot('00:00-00:30')).toBe('12:00 AM');
  });

  it('returns "—" for empty or malformed input', () => {
    expect(formatBucketTimeSlot('')).toBe('—');
    expect(formatBucketTimeSlot('not-a-time')).toBe('—');
    expect(formatBucketTimeSlot('25')).toBe('—');
  });
});
