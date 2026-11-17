// Shared contract between the server-side input builders (buildPromptInputs.ts)
// and the prompt text (promptBuilder.ts). Both import from here and never from
// each other, so they can be built and tested independently.
//
// Spec: ~/.claude/specs/line-wait-ml/ai-recommendation-expectations.md (sections 5, 6)
// Plan: ~/.claude/specs/line-wait-ml/ai-recommendation-expectations.plan.md (section 1)
//
// Every number the model might otherwise compute is precomputed into these
// fields. The field names below are the vocabulary the system prompt uses
// verbatim; renaming one here means renaming it in the prompt text and tests.

import { Ride } from '../types';

/** A candidate ride plus its walk from the guest. Structurally identical to
 *  promptBuilder.ts's RideForPrompt; lives here so the input builders do not
 *  import from the prompt module. */
export interface RideForPrompt {
  ride: Ride;
  walkMinutes: number | null;
  walkYards: number | null;
}

export type OfUsual = 'far-below' | 'below' | 'about' | 'above' | 'far-above';
export type FieldShape = 'flat' | 'mixed' | 'bad';
export type Restriction = 'toddler' | 'child' | 'pregnancy' | 'wheelchair' | 'sensory';
export type IdStyle = 'code' | 'uuid';

export interface RideLine {
  /** r1..rN, assigned nearest-first (walk asc, then name). */
  code: string;
  /** Real UUID. Never shown to the model in 'code' idStyle. */
  rideId: string;
  name: string;
  /** Posted wait in minutes. */
  wait: number | null;
  /** Estimated wait on arrival (computeArrivalWait). */
  arrive: number | null;
  /** Typical wait for right now (verdict.reasons.typical). */
  usual: number | null;
  ofUsual: OfUsual | null;
  /** wait - usual, signed, rounded. Null when either side is null. */
  vsUsual: number | null;
  /** Walking minutes from the guest's position. */
  walk: number | null;
  verdict: 'star' | 'go' | 'skip' | 'neutral';
  /** verdict.reasons.primary, or 'none'. */
  reason: string;
  /** In persona.mustDoRideIds (the Watching button writes to it). */
  wanted: boolean;
  /** Party-fit flags, same rules as app/frontend/src/personaSort.ts. */
  restricted: Restriction[];
  /** Minutes since the ride reopened, when within REOPEN_WINDOW_MIN; else null. */
  reopenedMinAgo: number | null;
  /** t+0, t+30, t+60, t+90, t+120 from historicalAverage, rounded. Length 5. */
  buckets: (number | null)[];
  /** Server-computed read of buckets vs wait: falling / rising when a future bucket is
   *  TREND_MIN_DELTA or more below / above the wait; flat otherwise; null without data. */
  trend: 'falling' | 'flat' | 'rising' | null;
  /** Best reachable lower window from verdict.reasons, as a clock time. */
  window: { wait: number; at: string } | null;
  /** The ride nearest the guest (the "Near X" header ride). */
  isAnchor: boolean;
}

export interface RequestContext {
  /** Display name, e.g. "Disneyland". */
  park: string;
  /** e.g. "Saturday 1:30 PM" in park-local time. */
  localTime: string;
  /** e.g. "11:00 PM", or null when hours are unknown. */
  closesAt: string | null;
  minutesUntilClose: number | null;
  field: FieldShape;
  /** e.g. "88F, feels like 92, clear", or null when unavailable. */
  weather: string | null;
  anchor: { code: string; name: string } | null;
  batchSize: number;
}

// ── Cutoffs (spec 6.2, 6.5, 6.6). Single source for builders, prompt, and tests. ──

/** current / typical thresholds for OfUsual. */
export const OF_USUAL_CUTOFFS = {
  farBelow: 0.6,   // ratio <  0.6  → 'far-below'
  below:    0.85,  // ratio <  0.85 → 'below'
  above:    1.15,  // ratio >  1.15 → 'above'   (0.85..1.15 → 'about')
  farAbove: 1.5,   // ratio >  1.5  → 'far-above'
} as const;

/** A field is 'flat' when every ride is about/below usual and the vsUsual spread is under this. */
export const FLAT_SPREAD_MAX_MIN = 15;

/** A field is 'bad' when no ride is below usual and at least this fraction are above. */
export const BAD_FIELD_ABOVE_FRACTION = 0.5;

/** Skip-verdict rides leave the candidate pool unless at least this fraction of the
 *  pool is skip (then there is nothing else to show). A wanted skip ride stays in
 *  either way but ranks after every non-skip pick (handler guardSkipLast). Decided
 *  2026-11-17: a red skip badge beside a recommendation looks bad when good options exist. */
export const SKIP_POOL_FRACTION = 0.8;

/** Reopen events older than this are not reported to the model. */
export const REOPEN_WINDOW_MIN = 60;

/** Buckets must move this many minutes from the wait to count as falling or rising. */
export const TREND_MIN_DELTA = 10;

/** Windows farther out than this are not shown to the model (layer2's EASE_WINDOW_MAX). */
export const WINDOW_MAX_MIN = 180;

/** Window clock times are rounded to this many minutes. */
export const WINDOW_ROUND_MIN = 5;
