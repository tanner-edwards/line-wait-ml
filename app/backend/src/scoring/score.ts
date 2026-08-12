import {
  Badge,
  Ride,
  ScoreResult,
  VerdictBreakdown,
  VerdictTrajectory,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Two-axis opportunity verdict.
//
// Full design + rationale: ~/.claude/specs/line-wait-ml/verdict-function-spec.md
// and verdict-retrospective.html.
//
//   AXIS 1  "How does this wait rank for THIS ride, and is it worth it?"
//           From history: p50 (worth) + position in p10/p90 (rank). GATES the
//           verdict (worth-line, skip-floor, p90 hard-skip) and SCALES it
//           (worth-weighted magnitude, star). Excel-able, and that's fine —
//           this axis only judges "is it a lot for this ride / worth waiting."
//
//   AXIS 2  "Where does NOW sit within TODAY's forecast?"
//           From the reachable rest-of-day curve (trajectory model 0–2h +
//           full-day profile 2h→close, future slots only): dayFloor (best wait
//           still reachable), savings (minutes gained by waiting for it), climb
//           (about to rise). This axis DECIDES the direction (go/neutral/skip).
//           It's the predictive part — the reason this isn't a spreadsheet.
//
// Combine: axis 1 says whether we speak and how loudly; axis 2 says what.
// ─────────────────────────────────────────────────────────────────────────────

// Keep in sync with scanner.js and app/frontend/src/scoreConstants.ts (all 10).
export const MIN_BUCKET_SAMPLE_COUNT = 10;

// --- Locked calibration (from real ride_stats, 2026-07-25) ---
export const SKIP_FLOOR_MIN = 15;      // current wait must clear this to ever be a Skip
export const GO_WORTH_LINE_MIN = 15;   // ride p50 must clear this to be Go/Star-eligible at all
export const GO_TIMING_WORTH_MIN = 25; // ride p50 for a "best-window" GO — timing only matters on
                                       // higher-demand rides; a spinner (p50 20) at its floor is
                                       // "ride whenever", not a green badge. Rare lows (≤p10) still
                                       // use GO_WORTH_LINE_MIN. Tunable.
export const GO_DISCOUNT_MIN = 0.15;   // (legacy) retained for reference; superseded by the
                                       // typical-based GO below.

// --- v2 calibration (fit to the hand-labeled set, 2026-08-01) ---
// The labels showed GO/STAR/SKIP are driven mostly by the ride's own
// distribution + the true typical-for-now, NOT the (still-flattening) forecast.
export const GO_WORTH_P90 = 25;        // a ride must be able to reach ≥ this (its p90) for timing to
                                       // matter — the worth gate. Below it → filler → never Go/Star.
export const SKIP_OVER_TYPICAL = 1.30; // current ≥ this × typical (and ≥ skip floor) → overpriced
                                       // vs its own norm → Skip, even under p90.
export const STAR_IMPROVEMENT_MIN = 12;// Star needs current ≤ p10 AND typical−current ≥ this — a
                                       // rare low that's ALSO well below the typical-for-now. Rope-
                                       // drop lows (typical already low → small gap) stay Go, not Star.
const SOON_HORIZON_MIN = 150;          // a better window within this many minutes…
const SOON_IMPROVE_MIN = 15;           // …that's ≥ this much lower can suppress a GO to Neutral.

// --- Tunable thresholds (calibrate by eyeballing the review harness) ---
const MIN_ZONE_SPREAD = 5;             // p90−p10 below this → distribution unreliable → suppress
const WALK_ROUNDTRIP_MIN = 12;         // leave-and-return cost baked into savings
const BEATABLE_SAVINGS_MIN = 15;       // DECAYED minutes a later window must save to justify a Skip
const EXTREME_DROP_MIN = 40;           // a huge RAW drop later today skips regardless of distance (decay can't bury it)
const FLOOR_SLACK_MIN = 0;             // decayed savings ≤ this → "now is the best window" (go)
const WORTH_WEIGHT_DIVISOR = 40;       // worth_weight = p50 / divisor (magnitude scaling)
const STAR_P50_MIN = 25;               // Star reserved for genuine headliners
const ML_MAX_HORIZON_MIN = 240;        // ML curve (t10..t240) owns the reachable near-to-mid window
const RAPID_SWING = 0.40;              // ±40% vs previous snapshot
const RAPID_ABS_MIN = 10;              // …and ≥10 min absolute (ignore small-number noise)

// --- Reachability decay (non-linear): how much a future better-window counts,
// by how far out it is. Gentle 0→4h (today-adaptive ML zone, trusted), steeper
// 4→8h (flattening calendar tail — discounted but NOT to zero). Floors at ~0.3:
// a far window still holds real weight, and the 4h knee is safe because the
// horizon slides — a 5h-out dip resurfaces inside the trusted window as the
// guest rides and re-checks, so we never need to promise it now. Tunable. ---
const DECAY_KNEE_H = 4, DECAY_KNEE_VAL = 0.7, DECAY_FAR_H = 8, DECAY_FAR_VAL = 0.3, DECAY_FLOOR = 0.3;
function reachabilityWeight(deltaMinutes: number): number {
  const h = deltaMinutes / 60;
  if (h <= DECAY_KNEE_H) return 1 - ((1 - DECAY_KNEE_VAL) / DECAY_KNEE_H) * h;
  const d = DECAY_KNEE_VAL - ((DECAY_KNEE_VAL - DECAY_FAR_VAL) / (DECAY_FAR_H - DECAY_KNEE_H)) * (h - DECAY_KNEE_H);
  return Math.max(DECAY_FLOOR, d);
}

const SUPPRESSED: ScoreResult = {
  score: 0,
  badge: null,
  factors: {
    zone: 'suppressed', typical: null, worthWeight: null, valueMinutes: null,
    betterWindowWait: null, betterWindowInMin: null, recoverableNet: null,
    reachableSoon: false, climb: false, trajectory: null, rapidChange: null,
  },
};

export function scoreRide(ride: Ride): ScoreResult {
  const { currentWait, status, rideStats } = ride;

  // Suppression — need a live wait, an operating ride, and enough history.
  if (currentWait === null || status !== 'OPERATING') return SUPPRESSED;
  const typicalBucket = (ride.historicalBaseline ?? ride.historicalAverage)?.buckets[0] ?? null;
  if (typicalBucket === null || typicalBucket.sampleCount < MIN_BUCKET_SAMPLE_COUNT) return SUPPRESSED;

  const typical = typicalBucket.wait;
  const rapid = computeRapidChange(ride, currentWait);
  const trajectory = trajectoryFromML(ride);

  // No usable distribution (new ride / shows / transport with p10=p50=p90) →
  // can't rank. Neutral, unless a real-time event fires (subject to floors).
  if (rideStats === null || rideStats.p90 - rideStats.p10 < MIN_ZONE_SPREAD) {
    let badge: Badge = null;
    if (rapid?.dir === 'drop') badge = 'go';
    else if (rapid?.dir === 'spike' && currentWait >= SKIP_FLOOR_MIN) badge = 'skip';
    const v: VerdictBreakdown = {
      zone: 'suppressed', typical, worthWeight: null, valueMinutes: null,
      betterWindowWait: null, betterWindowInMin: null, recoverableNet: null,
      reachableSoon: false, climb: false, trajectory,
      rapidChange: rapid ? { delta: rapid.delta, points: rapid.points } : null,
    };
    return { badge, score: signedScore(badge, v), factors: v };
  }

  const { p10, p50, p90 } = rideStats;
  const worthWeight = p50 / WORTH_WEIGHT_DIVISOR;

  // ── AXIS 2 — day position (reachability-weighted) ──
  // Kept for the score magnitude, the detail view, and a LIGHT go-suppression /
  // beatable-skip. The badge no longer leans hard on the forecast (the labels
  // showed distribution + typical drive the call; the forecast still flattens).
  const best = computeBestWindow(ride, currentWait);
  const savings = best ? best.eff : null;
  const reachableSoon = best !== null && best.dt <= 120;
  const climb = trajectory === 'rising' || trajectory === 'trough';
  // A meaningfully-better window reachably SOON (suppresses a GO to Neutral).
  const soonBetter = best !== null && best.dt <= SOON_HORIZON_MIN &&
    (currentWait - best.wait) >= SOON_IMPROVE_MIN;
  const floorIsNow = savings !== null && savings <= FLOOR_SLACK_MIN;

  // ── Worth + rank (distribution + true typical-for-now) ──
  const worthy = p90 >= GO_WORTH_P90;                 // can this ride get busy enough to time?
  const typ = typical ?? p50;                          // fall back to median if no baseline
  const rank: 'below-floor' | 'mid' | 'at-ceiling' =
    currentWait <= p10 ? 'below-floor' : currentWait >= p90 ? 'at-ceiling' : 'mid';
  const zone: VerdictBreakdown['zone'] =
    rank === 'below-floor' ? 'opportunity' : rank === 'at-ceiling' ? 'skip' : 'judgment';

  // ── Decide ──
  let badge: Badge = null;
  if (currentWait >= p90 && currentWait >= SKIP_FLOOR_MIN) {
    // Overpriced: at/above its own ceiling (≥, per the labeled set) and not a
    // trivial wait. Worth-independent.
    badge = 'skip';
  } else if (worthy && currentWait >= typ * SKIP_OVER_TYPICAL && currentWait >= SKIP_FLOOR_MIN) {
    // Meaningfully above the ride's typical-for-now → overpriced vs its own norm.
    badge = 'skip';
  } else if (worthy && currentWait <= p10 && (typ - currentWait) >= STAR_IMPROVEMENT_MIN) {
    // STAR — a rare low (≤ p10) that's ALSO well below the typical-for-now.
    // Rope-drop lows (typical already low → small gap) don't qualify.
    badge = 'star';
  } else if (worthy && currentWait <= typ && currentWait <= p50) {
    // GO — a busy-capable ride at/below both its median and its typical-for-now.
    // Suppressed to Neutral only if a much-better window is reachably soon.
    badge = soonBetter ? null : 'go';
  }

  // Rapid-change override — a real-time event, subordinate to the ceiling.
  if (badge !== 'star' && rapid) {
    if (rapid.dir === 'drop' && currentWait < p90 && worthy) {
      badge = badge ?? 'go';
    } else if (rapid.dir === 'spike' && currentWait >= p90 && currentWait >= SKIP_FLOOR_MIN) {
      badge = 'skip';
    }
  }

  const valueMinutes = worthy ? ((typical ?? p50) - currentWait) * worthWeight : null;
  const verdict: VerdictBreakdown = {
    zone, typical, worthWeight, valueMinutes,
    betterWindowWait: best?.wait ?? null, betterWindowInMin: best?.dt ?? null,
    recoverableNet: savings, reachableSoon, climb, trajectory,
    rapidChange: rapid ? { delta: rapid.delta, points: rapid.points } : null,
  };
  return {
    badge,
    score: signedScore(badge, verdict, currentWait, p90),
    factors: verdict,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Single trajectory signal, from the ML's own trend. Confidence-gated.
function trajectoryFromML(ride: Ride): VerdictTrajectory {
  const p = ride.prediction;
  if (!p || p.confidence === 'low') return null;
  return p.trend as VerdictTrajectory;
}

// The best future window to wait for — the one that MAXIMIZES reachability-
// decayed savings, so a moderate drop soon beats a huge drop at closing time.
//   • ML trajectory (t10..t240) owns the reachable near-to-mid window (today-
//     adaptive; wins ≤4h),
//   • full-day profile supplies windows beyond that (calendar tail),
//   • each candidate's raw savings (current − wait − walk) is scaled by
//     reachabilityWeight(Δt); we keep the best scaled result.
//   • fall back to p10 (treated as far) when neither forecast is available.
function computeBestWindow(
  ride: Ride,
  current: number
): { wait: number; dt: number; raw: number; eff: number; deepestRaw: number } | null {
  const slotStart = currentSlotStartMinutes(ride);
  const p = ride.prediction;
  const fd = ride.fullDayForecast ?? null;
  const hasML = p != null && p.confidence !== 'low';

  const candidates: { wait: number; dt: number }[] = [];
  if (hasML) {
    const curve: [number, number][] = [
      [10, p!.t10], [20, p!.t20], [30, p!.t30], [40, p!.t40], [50, p!.t50], [60, p!.t60],
      [90, p!.t90], [120, p!.t120], [150, p!.t150], [180, p!.t180], [210, p!.t210], [240, p!.t240],
    ];
    for (const [dt, w] of curve) if (w != null) candidates.push({ wait: w, dt });
  }
  const mlMaxDt = hasML ? ML_MAX_HORIZON_MIN : 0;
  if (fd && slotStart !== null) {
    for (const s of fd) {
      if (s.wait === null || s.startMinutes <= slotStart) continue;
      const dt = s.startMinutes - slotStart;
      if (dt <= mlMaxDt) continue;              // ML owns the near-to-mid horizon
      candidates.push({ wait: s.wait, dt });
    }
  }

  if (candidates.length === 0) {
    const p10 = ride.rideStats?.p10 ?? null;
    if (p10 === null) return null;
    const raw = current - p10 - WALK_ROUNDTRIP_MIN;
    return { wait: p10, dt: ML_MAX_HORIZON_MIN, raw, eff: raw * reachabilityWeight(ML_MAX_HORIZON_MIN), deepestRaw: raw };
  }

  // best = window with the highest DECAYED savings; deepestRaw = the single
  // largest RAW drop available anytime today (for the extreme-drop bypass).
  let best: { wait: number; dt: number; raw: number; eff: number } | null = null;
  let deepestRaw = -Infinity;
  for (const c of candidates) {
    const raw = current - c.wait - WALK_ROUNDTRIP_MIN;
    if (raw > deepestRaw) deepestRaw = raw;
    const eff = raw * reachabilityWeight(c.dt);
    if (best === null || eff > best.eff) best = { wait: c.wait, dt: c.dt, raw, eff };
  }
  return { ...best!, deepestRaw };
}

// Current 30-min slot start (minutes past LA-local midnight), parsed from the
// t+0 bucket's timeSlot ("10:30-11:00" → 630). Self-contained, no TZ math.
function currentSlotStartMinutes(ride: Ride): number | null {
  const ts = (ride.historicalBaseline ?? ride.historicalAverage)?.buckets[0]?.timeSlot;
  if (!ts) return null;
  const [h, m] = ts.split('-')[0].split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

interface RapidChange { delta: number; points: number; dir: 'drop' | 'spike' | null; }

function computeRapidChange(ride: Ride, currentWait: number): RapidChange | null {
  const prev = ride.recentHistory?.[0] ?? null;
  if (!prev || prev.wait === null || prev.wait <= 0 || prev.status !== 'OPERATING') return null;
  const delta = (currentWait - prev.wait) / prev.wait;
  const absDiff = Math.abs(currentWait - prev.wait);
  let dir: RapidChange['dir'] = null;
  if (absDiff >= RAPID_ABS_MIN) {
    if (delta <= -RAPID_SWING) dir = 'drop';
    else if (delta >= RAPID_SWING) dir = 'spike';
  }
  return { delta, points: dir === 'drop' ? 2 : dir === 'spike' ? -2 : 0, dir };
}

// Signed worth-weighted magnitude — the cross-ride currency ("good-minutes on
// the table"). Positive = opportunity, negative = skip.
function signedScore(badge: Badge, v: VerdictBreakdown, currentWait?: number, p90?: number): number {
  if (badge === 'star' || badge === 'go') return v.valueMinutes ?? 1;
  if (badge === 'skip') {
    if (v.recoverableNet !== null && v.recoverableNet > 0) return -v.recoverableNet;
    if (currentWait !== undefined && p90 !== undefined) return -(currentWait - p90);
    return -1;
  }
  return 0;
}
