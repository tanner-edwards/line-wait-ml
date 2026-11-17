// Default trip-date range for the claim and paywall screens, derived from the
// trip length the user already told us in onboarding (persona.tripDuration).
// The picker still lets them change either date; this only sets the start.

import { Persona, TripDuration } from '../types';

// Inclusive park days. Ranged buckets take the top of the range: access is a
// flat price for up to 10 days, so over-covering costs the user nothing,
// while ending a day early would.
export function defaultTripDays(tripDuration: TripDuration | null | undefined): number {
  switch (tripDuration) {
    case '1-day': return 1;
    case '2-days': return 2;
    case '3-4-days': return 4;
    case '5-plus-days': return 5;
    default: return 3; // no persona yet — the pre-persona default
  }
}

export function stripTime(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today through today + (days - 1), as YYYY-MM-DD strings. */
export function defaultTripRange(
  tripDuration: TripDuration | null | undefined,
  now: Date = new Date()
): { tripStart: string; tripEnd: string } {
  const start = stripTime(now);
  const end = addDays(start, defaultTripDays(tripDuration) - 1);
  return { tripStart: toYMD(start), tripEnd: toYMD(end) };
}

/** Inclusive day count of a YYYY-MM-DD range. */
export function tripDaysInRange(range: { tripStart: string; tripEnd: string }): number {
  const start = new Date(range.tripStart + 'T00:00:00');
  const end = new Date(range.tripEnd + 'T00:00:00');
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** Inverse of defaultTripDays: the persona bucket a day count falls in. */
export function tripDurationFromDays(days: number): TripDuration {
  if (days <= 1) return '1-day';
  if (days === 2) return '2-days';
  if (days <= 4) return '3-4-days';
  return '5-plus-days';
}

/**
 * If the user skipped the trip-length question in onboarding, the dates they
 * just activated stand in for it. The range is an upper bound on park days
 * (a 2-day visit can span 4 dates with rest days between), so this is a
 * starting guess the user can correct in Profile, and it never overwrites an
 * explicit answer. Returns the persona to save, or null when nothing changes.
 */
export function withDerivedTripDuration(
  persona: Persona | null,
  range: { tripStart: string; tripEnd: string }
): Persona | null {
  if (!persona || persona.tripDuration !== null) return null;
  return { ...persona, tripDuration: tripDurationFromDays(tripDaysInRange(range)) };
}
