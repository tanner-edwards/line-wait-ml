// Extracts today's park open/close window from the themeparks.wiki
// /schedule response. Returns null when there's no OPERATING entry for the
// requested date — the LLM context falls back to "unknown" and the softened
// system prompt copes.
//
// Why a dedicated module: the schedule endpoint can fail independently of
// the live feed, and the parsing is fiddly enough (date-keyed array, multi-
// window days, LA timezone) to deserve its own tests later.

import { fetchSchedule } from '../themeparksClient';
import { ParkSlug, ThemeparksScheduleEntry } from '../types';

const LA_TZ = 'America/Los_Angeles';

export interface ParkHours {
  open: string;   // "HH:MM" 24-hour LA local
  close: string;  // "HH:MM" 24-hour LA local
}

/**
 * Look up today's OPERATING window. `referenceDate` lets the time-travel
 * code path pull the right day's hours. Logs and returns null on any
 * fetch / parse failure — the caller treats null as "unknown".
 */
export async function getParkHours(
  parkSlug: ParkSlug,
  referenceDate: Date
): Promise<ParkHours | null> {
  let resp;
  try {
    resp = await fetchSchedule(parkSlug);
  } catch (err) {
    console.warn('schedule fetch failed; serving without park hours', err);
    return null;
  }

  const targetDate = laDateString(referenceDate);
  const entry = pickOperatingEntry(resp.schedule, targetDate);
  if (!entry) return null;

  return {
    open: laTimeOfDay(entry.openingTime),
    close: laTimeOfDay(entry.closingTime),
  };
}

/** "YYYY-MM-DD" in America/Los_Angeles, matching the schedule's `date` field. */
function laDateString(d: Date): string {
  // en-CA gives ISO-ordered YYYY-MM-DD on Node
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** "HH:MM" 24-hour, LA local, from an ISO-with-offset string. */
function laTimeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '??:??';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Disney parks sometimes list multiple windows for a single day (Magic
 * Morning, Early Entry, the main OPERATING block). Take the first
 * OPERATING entry for the target date — TICKETED_EVENT and CLOSED entries
 * are ignored.
 */
function pickOperatingEntry(
  schedule: ThemeparksScheduleEntry[],
  targetDate: string
): ThemeparksScheduleEntry | null {
  for (const entry of schedule) {
    if (entry.date === targetDate && entry.type === 'OPERATING') {
      return entry;
    }
  }
  return null;
}
