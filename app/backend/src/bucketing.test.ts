import { bucketOf, bucketsAroundNow } from './bucketing';

// Helper: build a Date that represents a specific LA-local time.
// 2026-06-15 is a Monday, mid-summer (PDT), well clear of DST edges.
// PDT = UTC-7.
function laTime(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 5, 15, hour + 7, minute));
}

describe('bucketOf', () => {
  it('floors :00–:29 to the :00 bucket', () => {
    expect(bucketOf(laTime(10, 0))).toBe('10:00-10:30');
    expect(bucketOf(laTime(10, 14))).toBe('10:00-10:30');
    expect(bucketOf(laTime(10, 29))).toBe('10:00-10:30');
  });

  it('floors :30–:59 to the :30 bucket', () => {
    expect(bucketOf(laTime(10, 30))).toBe('10:30-11:00');
    expect(bucketOf(laTime(10, 42))).toBe('10:30-11:00');
    expect(bucketOf(laTime(10, 59))).toBe('10:30-11:00');
  });

  it('handles midnight wraparound', () => {
    expect(bucketOf(laTime(23, 45))).toBe('23:30-00:00');
    expect(bucketOf(laTime(0, 0))).toBe('00:00-00:30');
  });

  it('uses LA local time when no timezone is given', () => {
    // 2026-06-15 16:00 UTC = 09:00 PT (PDT).
    const d = new Date(Date.UTC(2026, 5, 15, 16, 0));
    expect(bucketOf(d)).toBe('09:00-09:30');
  });

  it('honors an explicit non-default timezone', () => {
    // Same instant interpreted in two zones.
    const d = new Date(Date.UTC(2026, 5, 15, 16, 0));
    expect(bucketOf(d, 'America/Los_Angeles')).toBe('09:00-09:30');
    expect(bucketOf(d, 'America/New_York')).toBe('12:00-12:30'); // EDT = UTC-4
  });
});

describe('bucketsAroundNow', () => {
  it('returns [t+0, t+30, t+60, t+90, t+120] buckets in order', () => {
    // 10:15 PT → buckets at 10:00, 10:30, 11:00, 11:30, 12:00
    expect(bucketsAroundNow(laTime(10, 15))).toEqual([
      '10:00-10:30',
      '10:30-11:00',
      '11:00-11:30',
      '11:30-12:00',
      '12:00-12:30',
    ]);
  });

  it('handles wraparound when later buckets cross midnight', () => {
    // 23:15 PT → 23:00, 23:30, 00:00, 00:30, 01:00
    expect(bucketsAroundNow(laTime(23, 15))).toEqual([
      '23:00-23:30',
      '23:30-00:00',
      '00:00-00:30',
      '00:30-01:00',
      '01:00-01:30',
    ]);
  });

  it('handles a t+0 that starts exactly on a bucket boundary', () => {
    expect(bucketsAroundNow(laTime(10, 0))).toEqual([
      '10:00-10:30',
      '10:30-11:00',
      '11:00-11:30',
      '11:30-12:00',
      '12:00-12:30',
    ]);
  });
});
