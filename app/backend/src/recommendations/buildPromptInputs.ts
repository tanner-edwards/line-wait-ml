// Server-side inputs for the /v2/recommendations prompt.
//
// Every number the model might otherwise compute is precomputed here into the
// RideLine / RequestContext shapes from promptInputs.ts (the shared contract
// with promptBuilder.ts). Pure functions only: no I/O. The handler loads park
// hours, recent reopens, and weather, then hands them in.
//
// Spec: ~/.claude/specs/line-wait-ml/ai-recommendation-expectations.md (section 6)

import {
  HistoricalAverage,
  ParkSlug,
  PARKS,
  Persona,
  Ride,
  VerdictReasons,
} from '../types';
import {
  BAD_FIELD_ABOVE_FRACTION,
  FieldShape,
  FLAT_SPREAD_MAX_MIN,
  OF_USUAL_CUTOFFS,
  OfUsual,
  RequestContext,
  Restriction,
  RideForPrompt,
  RideLine,
  WINDOW_ROUND_MIN,
} from './promptInputs';

// ── Time zones ──

/** IANA time zone per park. A Record so a new park slug (e.g. a WDW park)
 *  fails to compile until it gets a zone (WDW parks: America/New_York). */
export const PARK_TIME_ZONES: Record<ParkSlug, string> = {
  'disneyland': 'America/Los_Angeles',
  'california-adventure': 'America/Los_Angeles',
};

export function parkTimeZone(slug: ParkSlug): string {
  return PARK_TIME_ZONES[slug];
}

// Node's ICU puts a narrow no-break space (U+202F) before AM/PM. Normalize to
// a plain space so the model and tests see "8:00 PM".
function cleanSpaces(s: string): string {
  return s.replace(/[  ]/g, ' ');
}

/** "Saturday 1:30 PM" in the given zone. */
export function formatLocalTime(date: Date, timeZone: string): string {
  return cleanSpaces(new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date));
}

/** "8:00 PM" in the given zone. */
export function formatClock(date: Date, timeZone: string): string {
  return cleanSpaces(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date));
}

/** Minutes since local midnight in the given zone. */
export function localMinutesOfDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "23:00" → "11:00 PM". Null on a malformed input. */
export function hhmmTo12h(s: string): string | null {
  const min = parseHHMM(s);
  if (min === null) return null;
  const h24 = Math.floor(min / 60) % 24;
  const mm = String(min % 60).padStart(2, '0');
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

/**
 * Minutes from `now` until the park's listed close. Null when hours are
 * unknown or malformed. Clamped at 0 after close. A close at or before the
 * open time (e.g. "00:00" or "01:00") is read as after midnight.
 */
export function minutesUntilClose(
  hours: { open: string; close: string } | null,
  now: Date,
  timeZone: string,
): number | null {
  if (!hours) return null;
  const open = parseHHMM(hours.open);
  let close = parseHHMM(hours.close);
  if (open === null || close === null) return null;
  if (close <= open) close += 1440;
  let nowMin = localMinutesOfDay(now, timeZone);
  // After midnight on a past-midnight close day: still the same operating day.
  if (close > 1440 && nowMin < close - 1440) nowMin += 1440;
  return Math.max(0, close - nowMin);
}

// ── 6.1 Ride codes ──

/**
 * Assign r1..rN nearest-first (walk ascending, unknown walk last, ties by
 * name). The returned Map iterates in code order.
 */
export function assignCodes(candidates: RideForPrompt[]): Map<string, RideForPrompt> {
  const sorted = [...candidates].sort((a, b) => {
    const wa = a.walkMinutes ?? Infinity;
    const wb = b.walkMinutes ?? Infinity;
    if (wa !== wb) return wa - wb;
    const n = a.ride.name.localeCompare(b.ride.name);
    if (n !== 0) return n;
    return a.ride.id.localeCompare(b.ride.id);
  });
  const map = new Map<string, RideForPrompt>();
  sorted.forEach((c, i) => map.set(`r${i + 1}`, c));
  return map;
}

// ── 6.2 Comparison fields ──

export function ofUsual(wait: number | null, usual: number | null): OfUsual | null {
  if (wait === null || usual === null || usual <= 0) return null;
  const ratio = wait / usual;
  if (ratio < OF_USUAL_CUTOFFS.farBelow) return 'far-below';
  if (ratio < OF_USUAL_CUTOFFS.below) return 'below';
  if (ratio > OF_USUAL_CUTOFFS.farAbove) return 'far-above';
  if (ratio > OF_USUAL_CUTOFFS.above) return 'above';
  return 'about';
}

export function vsUsual(wait: number | null, usual: number | null): number | null {
  if (wait === null || usual === null) return null;
  return Math.round(wait - usual);
}

/**
 * Estimated wait when the guest reaches the queue: current wait plus the
 * t+0 → t+30 bucket slope over the walk. Flat when buckets are missing.
 */
export function computeArrivalWait(
  currentWait: number | null,
  walkMinutes: number | null,
  ha: HistoricalAverage | null,
): number | null {
  if (currentWait === null) return null;
  if (walkMinutes === null) return currentWait;
  const b0 = ha?.buckets[0]; // t+0
  const b1 = ha?.buckets[1]; // t+30
  if (b0?.wait != null && b1?.wait != null && b0.sampleCount > 0 && b1.sampleCount > 0) {
    const slopePerMin = (b1.wait - b0.wait) / 30;
    return Math.max(0, Math.round(currentWait + slopePerMin * walkMinutes));
  }
  return currentWait;
}

// ── 6.4 Party fit (port of app/frontend/src/personaSort.ts) ──

/** Typical height in inches by age (~50th percentile). MUST match
 *  TYPICAL_HEIGHT_IN in app/frontend/src/personaSort.ts; a parity test pins it. */
export const TYPICAL_HEIGHT_IN: Record<number, number> = {
  0: 24, 1: 30, 2: 34, 3: 37, 4: 40, 5: 43,
  6: 45, 7: 48, 8: 50, 9: 52, 10: 54, 11: 56, 12: 58,
};

export function typicalHeightInches(age: number): number {
  if (age >= 13) return 72; // adult, clears every ride
  if (age <= 0) return TYPICAL_HEIGHT_IN[0];
  return TYPICAL_HEIGHT_IN[age] ?? 72;
}

/** Age at or under which a height-restricted youngest is labelled 'toddler'
 *  rather than 'child' (matches persona.ts ageText). */
export const TODDLER_MAX_AGE = 3;

export function restrictedFor(ride: Ride, persona: Persona | null | undefined): Restriction[] {
  if (!persona) return [];
  const out: Restriction[] = [];
  if (persona.youngestAge != null && ride.heightMinIn != null) {
    if (typicalHeightInches(persona.youngestAge) < ride.heightMinIn) {
      out.push(persona.youngestAge <= TODDLER_MAX_AGE ? 'toddler' : 'child');
    }
  }
  const intense = ride.thrillLevel != null && ride.thrillLevel >= 4;
  const needs = persona.accessibilityNeeds ?? [];
  if (needs.includes('pregnant') && (ride.pregnancyAdvisory || intense)) out.push('pregnancy');
  if (needs.includes('wheelchair') && ride.transferRequired) out.push('wheelchair');
  if (needs.includes('sensory') && intense) out.push('sensory');
  return out;
}

// ── 6.5 Field shape ──

const BELOW: ReadonlySet<OfUsual> = new Set(['below', 'far-below']);
const ABOVE: ReadonlySet<OfUsual> = new Set(['above', 'far-above']);

/**
 * flat | mixed | bad over the candidate pool. Rides without an ofUsual
 * (no typical) do not vote.
 *   bad:  none below usual, and at least BAD_FIELD_ABOVE_FRACTION above.
 *   flat: none above usual, and the vsUsual spread is under FLAT_SPREAD_MAX_MIN.
 *   mixed otherwise.
 */
export function fieldShape(lines: Pick<RideLine, 'ofUsual' | 'vsUsual'>[]): FieldShape {
  const rated = lines.filter(l => l.ofUsual !== null);
  if (rated.length === 0) return 'mixed';
  const anyBelow = rated.some(l => BELOW.has(l.ofUsual!));
  const aboveCount = rated.filter(l => ABOVE.has(l.ofUsual!)).length;
  if (!anyBelow && aboveCount / rated.length >= BAD_FIELD_ABOVE_FRACTION) return 'bad';
  if (aboveCount === 0) {
    const vs = rated.map(l => l.vsUsual).filter((v): v is number => v !== null);
    const spread = vs.length > 0 ? Math.max(...vs) - Math.min(...vs) : 0;
    if (spread < FLAT_SPREAD_MAX_MIN) return 'flat';
  }
  return 'mixed';
}

// ── 6.7 Closing math ──

/** True when hours are unknown; otherwise the walk (0 if unknown) must fit
 *  before close. A guest in line at close still rides, so the queue wait does
 *  not count. */
export function reachableBeforeClose(walk: number | null, minutesUntilCloseVal: number | null): boolean {
  if (minutesUntilCloseVal === null) return true;
  return (walk ?? 0) < minutesUntilCloseVal;
}

// ── 6.8 Forecast evidence ──

/**
 * The verdict engine's best lower window as a park-local clock time, rounded
 * to WINDOW_ROUND_MIN. Null when there is no window. No horizon cutoff.
 * betterWindowInMin is measured from the current 30-min slot start for the
 * far (fullDayForecast) part of the curve, so the clock time is approximate
 * to within that slot; rounding absorbs most of it.
 */
export function formatWindow(
  reasons: VerdictReasons | null | undefined,
  now: Date,
  timeZone: string,
): { wait: number; at: string } | null {
  if (!reasons) return null;
  const { betterWindowWait: w, betterWindowInMin: inMin } = reasons;
  if (w == null || inMin == null) return null;
  const step = WINDOW_ROUND_MIN * 60_000;
  const at = new Date(Math.round((now.getTime() + inMin * 60_000) / step) * step);
  return { wait: Math.round(w), at: formatClock(at, timeZone) };
}

/** t+0..t+120 waits from historicalAverage (the ML curve when ML is active),
 *  rounded. Always length 5; null where missing. */
export function bucketsFor(ride: Ride): (number | null)[] {
  const b = ride.historicalAverage?.buckets;
  return [0, 1, 2, 3, 4].map(i => {
    const w = b?.[i]?.wait;
    return w == null ? null : Math.round(w);
  });
}

// ── Assembly ──

export interface RideLineInputs {
  persona: Persona | null | undefined;
  /** rideId → minutes since reopen, from loadRecentReopens. */
  reopens: Map<string, number>;
  /** UUID of the nearest ride (the "Near X" header ride), or null. */
  anchorRideId: string | null;
  now: Date;
  timeZone: string;
}

/** One RideLine per coded candidate, in code order. */
export function buildRideLines(
  codeMap: Map<string, RideForPrompt>,
  inputs: RideLineInputs,
): RideLine[] {
  const wanted = new Set(inputs.persona?.mustDoRideIds ?? []);
  const lines: RideLine[] = [];
  for (const [code, c] of codeMap) {
    const { ride, walkMinutes } = c;
    const reasons = ride.verdict?.reasons ?? null;
    const wait = ride.currentWait;
    const usual = reasons?.typical == null ? null : Math.round(reasons.typical);
    lines.push({
      code,
      rideId: ride.id,
      name: ride.name,
      wait,
      arrive: computeArrivalWait(wait, walkMinutes, ride.historicalAverage ?? null),
      usual,
      ofUsual: ofUsual(wait, usual),
      vsUsual: vsUsual(wait, usual),
      walk: walkMinutes,
      verdict: ride.verdict?.verdict ?? 'neutral',
      reason: reasons?.primary ?? 'none',
      wanted: wanted.has(ride.id),
      restricted: restrictedFor(ride, inputs.persona),
      reopenedMinAgo: inputs.reopens.get(ride.id) ?? null,
      buckets: bucketsFor(ride),
      window: formatWindow(reasons, inputs.now, inputs.timeZone),
      isAnchor: inputs.anchorRideId !== null && ride.id === inputs.anchorRideId,
    });
  }
  return lines;
}

export interface RequestContextInputs {
  parkSlug: ParkSlug;
  now: Date;
  parkHours: { open: string; close: string } | null;
  lines: RideLine[];
  weather: string | null;
  batchSize: number;
}

export function buildRequestContext(inputs: RequestContextInputs): RequestContext {
  const tz = parkTimeZone(inputs.parkSlug);
  const anchorLine = inputs.lines.find(l => l.isAnchor) ?? null;
  return {
    park: PARKS[inputs.parkSlug].name,
    localTime: formatLocalTime(inputs.now, tz),
    closesAt: inputs.parkHours ? hhmmTo12h(inputs.parkHours.close) : null,
    minutesUntilClose: minutesUntilClose(inputs.parkHours, inputs.now, tz),
    field: fieldShape(inputs.lines),
    weather: inputs.weather,
    anchor: anchorLine ? { code: anchorLine.code, name: anchorLine.name } : null,
    batchSize: inputs.batchSize,
  };
}

// ── Output parsing helpers ──

/** Lowercase, strip diacritics and punctuation, collapse whitespace. Used on
 *  both sides of the code-plus-name check in parseAndValidate. */
export function normalizeRideName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
