// Client mirror of backend/src/tripEdit.ts — bounds the date picker when
// editing a trip. The server re-checks every edit; keep the two in sync.
//
// Before access opens (the travel day, tripStart − 1): purchase rules.
// Once it opens: the trip can't end past travel day + 9, the start can move
// later until it arrives, then only the end can change. After tripEnd: locked.

import { TripRecord } from '../types';

export const MAX_TRIP_DAYS = 10;
export const MAX_START_DAYS_OUT = 90;

export function shiftDate(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export interface TripEditLimits {
  startLocked: boolean;
  minStart: string;
  maxStart: string;
  /** Latest allowed end once access has opened; null before. */
  endCap: string | null;
}

/** What an edit may do today (YYYY-MM-DD), or null if the trip is over. */
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
  };
}
