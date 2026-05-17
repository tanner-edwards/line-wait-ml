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
 * Formats an ISO timestamp as "HH:MM" in the user's local time zone.
 * Returns "—" if the input is null or unparseable.
 */
export function formatHHMM(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
