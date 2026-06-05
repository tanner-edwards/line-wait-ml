// 30-minute time-of-day bucketing. The cron uses this to label each
// wait_times sample by its LA-local 30-min window. The waits handler uses
// the same shape to look up "current bucket" + 30-min and 60-min offsets.
//
// Bucket label format: "HH:MM-HH:MM" using LA-local wall-clock time.

const DEFAULT_TZ = 'America/Los_Angeles';

function localHoursMinutes(date: Date, timezone: string): { h: number; m: number } {
  // Intl.DateTimeFormat with hourCycle:'h23' guarantees 00-23 hour values
  // (no AM/PM, no leading-zero ambiguity).
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const h = Number(parts.find(p => p.type === 'hour')?.value);
  const m = Number(parts.find(p => p.type === 'minute')?.value);
  return { h, m };
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Returns the 30-minute bucket label for a given Date in the given timezone.
 *  10:00 → "10:00-10:30"
 *  10:42 → "10:30-11:00"
 *  23:55 → "23:30-00:00"
 *
 * Buckets wrap at end-of-day for visual clarity; the cron treats them as
 * opaque string keys so the wraparound is cosmetic only.
 */
export function bucketOf(date: Date, timezone: string = DEFAULT_TZ): string {
  const { h, m } = localHoursMinutes(date, timezone);
  const bucketStartMin = m < 30 ? 0 : 30;
  const bucketEndMin = bucketStartMin === 0 ? 30 : 0;
  const bucketEndHour = bucketStartMin === 0 ? h : (h + 1) % 24;
  return `${pad2(h)}:${pad2(bucketStartMin)}-${pad2(bucketEndHour)}:${pad2(bucketEndMin)}`;
}

/**
 * Returns the six buckets [t+0, t+30, t+60, t+90, t+120, t+150] starting from the given Date.
 * Used by the waits handler at request time to look up the current and
 * near-future historical averages for a ride. The extra t+150 bucket lets
 * the frontend maintain a full 2-hour lookahead when it shifts the window
 * forward because the next slot is imminent (within 5 minutes).
 */
export function bucketsAroundNow(
  now: Date,
  timezone: string = DEFAULT_TZ
): [string, string, string, string, string, string] {
  const plus30  = new Date(now.getTime() +  30 * 60_000);
  const plus60  = new Date(now.getTime() +  60 * 60_000);
  const plus90  = new Date(now.getTime() +  90 * 60_000);
  const plus120 = new Date(now.getTime() + 120 * 60_000);
  const plus150 = new Date(now.getTime() + 150 * 60_000);
  return [
    bucketOf(now, timezone),
    bucketOf(plus30, timezone),
    bucketOf(plus60, timezone),
    bucketOf(plus90, timezone),
    bucketOf(plus120, timezone),
    bucketOf(plus150, timezone),
  ];
}
