import { CombinedResponse } from './types';
import { successfulParks } from './grouping';

/**
 * Returns the older of the two parks' lastUpdated ISO timestamps — i.e. the
 * worst-case freshness. If only one park has data, returns that one. If neither
 * has data (both errored), returns null.
 */
export function olderLastUpdated(response: CombinedResponse): string | null {
  const successes = successfulParks(response);
  if (successes.length === 0) return null;
  return successes
    .map(p => p.lastUpdated)
    .sort((a, b) => a.localeCompare(b))[0];
}

/**
 * Formats an ISO timestamp as "h:MM AM/PM" in the user's local time zone.
 * Returns "—" if the input is null or unparseable.
 */
export function formatHHMM(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const h = date.getHours() % 12 || 12;
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ampm = date.getHours() < 12 ? 'AM' : 'PM';
  return `${h}:${mm} ${ampm}`;
}

/**
 * Formats an ISO timestamp as a relative duration like "~30m ago" / "~2h ago".
 * Used for closed-ride rows so the user can see how long ago a ride went down.
 * Returns "" if the input is null or unparseable.
 */
export function formatTimeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutesAgo = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutesAgo < 60) return `~${minutesAgo}m ago`;
  const hoursAgo = minutesAgo / 60;
  if (hoursAgo < 10) return `~${Math.round(hoursAgo * 10) / 10}h ago`;
  return `~${Math.round(hoursAgo)}h ago`;
}

/**
 * Formats a bucket's `timeSlot` (e.g. "10:30-11:00") as a 12-hour start time
 * (e.g. "10:30 AM"). The timeSlot is already in California (America/Los_Angeles)
 * wall-clock time. Returns "—" if the input is empty or malformed.
 */
export function formatBucketTimeSlot(timeSlot: string): string {
  if (!timeSlot) return '—';
  const start = timeSlot.split('-')[0];
  const [hStr, mStr] = start.split(':');
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h) || !mStr) return '—';
  const mm = mStr.padStart(2, '0');
  const h12 = h % 12 || 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${mm} ${ampm}`;
}
