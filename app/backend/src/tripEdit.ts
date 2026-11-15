// Trip date edits (PUT /v1/users/trip). Pure rules — no Firestore — so they
// unit test directly. Mirrored client-side in frontend/src/utils/tripEdit.ts
// to bound the date picker; this copy is the authority.
//
// Before access opens (the travel day, tripStart − 1): same rules as buying
//   a trip — start today…today+90, 1–10 days.
// Once access opens: the travel day becomes the anchor, persisted as
//   accessOpenedOn on the first edit so pushing the start out later can't
//   reset it. The trip can't end past anchor + 9 (10 days including the
//   travel day), however many edits. The start can still move later until
//   it arrives (a rest day); after that only the end can change.
// After tripEnd: no edits.

import { TripRecord } from './types';

export const MAX_TRIP_DAYS = 10;
export const MAX_START_DAYS_OUT = 90;

// Shift a YYYY-MM-DD date string by whole days. Anchored at noon UTC so the
// shift never lands on a DST transition and flips the date.
export function shiftDate(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count of a YYYY-MM-DD range. */
function daysInclusive(start: string, end: string): number {
  const ms = new Date(end + 'T12:00:00Z').getTime() - new Date(start + 'T12:00:00Z').getTime();
  return Math.round(ms / 86_400_000) + 1;
}

function isYMD(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface TripEditLimits {
  /** Start can't change — it's today or earlier. */
  startLocked: boolean;
  minStart: string;
  maxStart: string;
  /** Latest allowed end once access has opened (anchor + 9); null before. */
  endCap: string | null;
  /** The travel day access opened on; null before it opens. */
  anchor: string | null;
}

/** What an edit may do today, or null if the trip can't be edited. */
export function tripEditLimits(
  trip: Pick<TripRecord, 'tripStart' | 'tripEnd' | 'accessOpenedOn'>,
  today: string
): TripEditLimits | null {
  if (today > trip.tripEnd) return null;
  const travelDay = shiftDate(trip.tripStart, -1);
  const anchor = trip.accessOpenedOn ?? (today >= travelDay ? travelDay : null);
  const endCap = anchor ? shiftDate(anchor, MAX_TRIP_DAYS - 1) : null;
  const startLocked = today >= trip.tripStart;
  return {
    startLocked,
    minStart: startLocked ? trip.tripStart : today,
    maxStart: startLocked ? trip.tripStart : endCap ?? shiftDate(today, MAX_START_DAYS_OUT),
    endCap,
    anchor,
  };
}

/** Error message for a rejected edit, or null when the new dates are allowed. */
export function validateTripEdit(
  trip: Pick<TripRecord, 'tripStart' | 'tripEnd' | 'accessOpenedOn'>,
  tripStart: string,
  tripEnd: string,
  today: string
): string | null {
  if (!isYMD(tripStart) || !isYMD(tripEnd)) return 'Dates must be YYYY-MM-DD';
  const limits = tripEditLimits(trip, today);
  if (!limits) return 'This trip has ended';
  if (limits.startLocked && tripStart !== trip.tripStart) {
    return "Your trip has started — only the end date can change";
  }
  if (tripStart < limits.minStart) return "The start date can't be in the past";
  if (tripStart > limits.maxStart) return 'That start date is too far out';
  if (tripEnd < tripStart) return 'The end date must be on or after the start date';
  if (tripEnd < today) return "The end date can't be in the past";
  if (daysInclusive(tripStart, tripEnd) > MAX_TRIP_DAYS) return `Trips are limited to ${MAX_TRIP_DAYS} days`;
  if (limits.endCap && tripEnd > limits.endCap) {
    return `Trips are limited to ${MAX_TRIP_DAYS} days from your first day of access`;
  }
  return null;
}
