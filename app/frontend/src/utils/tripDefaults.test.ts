import { defaultTripDays, defaultTripRange, tripDaysInRange, tripDurationFromDays, withDerivedTripDuration } from './tripDefaults';
import { emptyPersona } from '../types';

describe('defaultTripDays', () => {
  it('maps each persona bucket to an inclusive day count, top of range for ranges', () => {
    expect(defaultTripDays('1-day')).toBe(1);
    expect(defaultTripDays('2-days')).toBe(2);
    expect(defaultTripDays('3-4-days')).toBe(4);
    expect(defaultTripDays('5-plus-days')).toBe(5);
  });

  it('falls back to 3 days with no persona', () => {
    expect(defaultTripDays(null)).toBe(3);
    expect(defaultTripDays(undefined)).toBe(3);
  });
});

describe('defaultTripRange', () => {
  const nov9 = new Date(2026, 10, 9, 15, 30);

  it('a 2-day trip starting 11/9 ends 11/10', () => {
    expect(defaultTripRange('2-days', nov9)).toEqual({ tripStart: '2026-11-09', tripEnd: '2026-11-10' });
  });

  it('a 1-day trip starts and ends on the same day', () => {
    expect(defaultTripRange('1-day', nov9)).toEqual({ tripStart: '2026-11-09', tripEnd: '2026-11-09' });
  });

  it('keeps the old today+2 default when there is no persona', () => {
    expect(defaultTripRange(null, nov9)).toEqual({ tripStart: '2026-11-09', tripEnd: '2026-11-11' });
  });

  it('crosses a month boundary', () => {
    expect(defaultTripRange('5-plus-days', new Date(2026, 10, 29))).toEqual({
      tripStart: '2026-11-29',
      tripEnd: '2026-12-03',
    });
  });
});

describe('tripDurationFromDays', () => {
  it('buckets a day count the way onboarding does', () => {
    expect(tripDurationFromDays(1)).toBe('1-day');
    expect(tripDurationFromDays(2)).toBe('2-days');
    expect(tripDurationFromDays(3)).toBe('3-4-days');
    expect(tripDurationFromDays(4)).toBe('3-4-days');
    expect(tripDurationFromDays(5)).toBe('5-plus-days');
    expect(tripDurationFromDays(10)).toBe('5-plus-days');
  });

  it('round-trips with defaultTripDays', () => {
    for (const d of ['1-day', '2-days', '3-4-days', '5-plus-days'] as const) {
      expect(tripDurationFromDays(defaultTripDays(d))).toBe(d);
    }
  });
});

describe('tripDaysInRange', () => {
  it('counts inclusive days', () => {
    expect(tripDaysInRange({ tripStart: '2026-11-09', tripEnd: '2026-11-09' })).toBe(1);
    expect(tripDaysInRange({ tripStart: '2026-11-09', tripEnd: '2026-11-10' })).toBe(2);
    expect(tripDaysInRange({ tripStart: '2026-11-29', tripEnd: '2026-12-03' })).toBe(5);
  });
});

describe('withDerivedTripDuration', () => {
  const range = { tripStart: '2026-11-09', tripEnd: '2026-11-13' };

  it('fills in a skipped answer from the dates', () => {
    const persona = { ...emptyPersona(), tripDuration: null };
    expect(withDerivedTripDuration(persona, range)?.tripDuration).toBe('5-plus-days');
  });

  it('never overwrites an explicit answer', () => {
    const persona = { ...emptyPersona(), tripDuration: '2-days' as const };
    expect(withDerivedTripDuration(persona, range)).toBeNull();
  });

  it('does nothing without a persona', () => {
    expect(withDerivedTripDuration(null, range)).toBeNull();
  });
});
