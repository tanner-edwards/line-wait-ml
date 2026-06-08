import { Badge, FactorBreakdown, Ride, ScoreResult } from '../types';

// Minimum bucket0 sampleCount before scoring is considered trustworthy.
// Raised from 1 → 10 on 2026-06-07 (~36 days of data). Raise toward 20
// around 2026-07-07 once weekend counts reach ~60 samples/bucket.
// Keep in sync with: scanner.js MIN_BUCKET_SAMPLE_COUNT,
//                    app/frontend/src/scoreConstants.ts MIN_BUCKET_SAMPLE_COUNT
export const MIN_BUCKET_SAMPLE_COUNT = 10;

const SUPPRESSED: ScoreResult = {
  score: 0,
  badge: null,
  factors: {
    vsAvg: null,
    vsRange: null,
    projectedChange: null,
    nearTermChange: null,
    rapidChange: null,
  },
};

export function scoreRide(ride: Ride): ScoreResult {
  const { currentWait, status, historicalAverage, rideStats } = ride;

  // Suppression rules — no badge when data is absent or unreliable.
  if (
    currentWait === null ||
    status !== 'OPERATING' ||
    historicalAverage === null
  ) {
    return SUPPRESSED;
  }

  const bucket0 = historicalAverage.buckets[0];
  const bucket1 = historicalAverage.buckets[1];
  const bucket3 = historicalAverage.buckets[3];
  const bucket4 = historicalAverage.buckets[4];

  // Minimum sample count for the t+0 bucket before we'll score a ride. The
  // intent of this gate is "don't claim a pattern off thin data" — when a
  // (ride, bucket, dayType) cell has too few historical observations the
  // signal is noise. Production target is ~20, matching the BelowNormalBadge
  // gate and the TrendArrow lowConfidence threshold. Currently set to 1
  // because data collection started 2026-05-02 — weekend cells only have
  // ~18 samples max (6 weekend days × 3 polls per 30-min bucket), so the
  // 20-cap suppressed every weekend score. Raise back toward 20 once the
  // wait_times collection has accumulated several months.
  if (bucket0.sampleCount < MIN_BUCKET_SAMPLE_COUNT) return SUPPRESSED;

  // --- Factor 1: current wait vs. t+0 bucket average (max ±2) ---
  let vsAvg: FactorBreakdown['vsAvg'];
  let f1 = 0;
  if (bucket0.wait !== null && bucket0.wait !== 0) {
    const delta = (currentWait - bucket0.wait) / bucket0.wait;
    // Absolute-difference floor scales with typical wait so an 8-min drop
    // on a 68-min headliner doesn't look the same as an 8-min drop on a
    // 15-min ride. Anchors: 20→5, 50→10, 90→15, 120→20, with linear
    // interpolation between. Caps at 20 above typical=120.
    if (Math.abs(currentWait - bucket0.wait) >= absoluteFloorForTypical(bucket0.wait)) {
      if      (delta < -0.25) f1 = +2;
      else if (delta < -0.10) f1 = +1;
      else if (delta >  0.25) f1 = -2;
      else if (delta >  0.10) f1 = -1;
    }
    vsAvg = { delta, points: f1 };
  } else {
    vsAvg = null;
  }

  // --- Factor 2: position in p10/p90 range (max ±2) ---
  let vsRange: FactorBreakdown['vsRange'] = null;
  let f2 = 0;
  if (rideStats != null) {
    const range = rideStats.p90 - rideStats.p10;
    if (range >= 5) {
      const pct = Math.max(0, Math.min(1, (currentWait - rideStats.p10) / range));
      if      (currentWait <= rideStats.p10)  f2 = +2;
      else if (pct < 0.25)                    f2 = +1;
      else if (currentWait >= rideStats.p90)  f2 = -2;
      else if (pct > 0.75)                    f2 = -1;
      vsRange = { pct, points: f2 };
    }
  }

  // --- Factor 3: projected change, anchored early window vs late window (max ±2) ---
  // earlyAvg = avg(currentWait, t+30)  lateAvg = avg(t+90, t+120)
  let projectedChange: FactorBreakdown['projectedChange'] = null;
  let f3 = 0;
  const b1w = bucket1.wait;
  const b3w = bucket3.wait, b4w = bucket4.wait;
  const earlyAvg = b1w !== null ? (currentWait + b1w) / 2 : currentWait;
  const lateAvg  = (b3w !== null && b4w !== null) ? (b3w + b4w) / 2 : (b3w ?? b4w);
  if (currentWait !== 0 && lateAvg !== null) {
    const delta = (lateAvg - earlyAvg) / earlyAvg;
    if (Math.abs(lateAvg - earlyAvg) >= 10) {
      if      (delta < -0.25) f3 = -2;
      else if (delta < -0.10) f3 = -1;
      else if (delta >  0.25) f3 = +2;
      else if (delta >  0.10) f3 = +1;
    }
    projectedChange = { delta, points: f3 };
  }

  // --- Factor 4: near-term change, current → t+30 (max ±1) ---
  let nearTermChange: FactorBreakdown['nearTermChange'] = null;
  let f4 = 0;
  if (b1w !== null && currentWait > 0) {
    const minuteDelta = b1w - currentWait;
    const threshold = Math.max(10, currentWait * 0.20);
    if (Math.abs(minuteDelta) >= threshold) {
      f4 = minuteDelta > 0 ? +1 : -1;
    }
    nearTermChange = { delta: minuteDelta / currentWait, points: f4 };
  }

  const score = f1 + f2 + f3 + f4;

  // Rapid change: ≥40% swing from the previous OPERATING snapshot. Fires
  // 'go'/'skip' as an override even when score-based factors are neutral
  // (e.g., a wait that's still above average but dropped dramatically).
  // Guard: previousStatus must be 'OPERATING' to exclude reopen-from-DOWN
  // scenarios where a jump from 0 → 45 min looks like a +Inf% spike.
  const previousWait   = ride.recentHistory?.[0]?.wait   ?? null;
  const previousStatus = ride.recentHistory?.[0]?.status ?? null;
  let rapidChange: FactorBreakdown['rapidChange'] = null;
  let isRapidDrop  = false;
  let isRapidSpike = false;
  if (previousWait !== null && previousWait > 0 && previousStatus === 'OPERATING') {
    const delta   = (currentWait - previousWait) / previousWait;
    const absDiff = Math.abs(currentWait - previousWait);
    if (absDiff >= 10) {
      isRapidDrop  = delta <= -0.40;
      isRapidSpike = delta >= +0.40;
    }
    rapidChange = { delta, points: isRapidDrop ? +2 : isRapidSpike ? -2 : 0 };
  }

  // Gold star: rare exceptional opportunity. All four conditions must hold.
  // The p50 >= 25 guard prevents low-demand walk-on rides from earning a star
  // just because their already-short wait dipped slightly lower than usual.
  // Gold star: three conditions, no projection requirement. A headliner at its
  // historical floor and 30%+ below its slot average is a star moment whether
  // the model says the wait bounces back in 90 min or stays low — the rarity
  // IS the signal. The p50 >= 25 guard prevents permanent walk-on rides (Dumbo,
  // Carousel) from earning stars just because their already-short wait dipped.
  const isGoldStar =
    rideStats != null &&
    rideStats.p50 >= 25 &&
    currentWait <= rideStats.p10 * 1.15 &&
    vsAvg !== null && vsAvg.delta < -0.30;

  let badge: Badge;
  if (isGoldStar) {
    badge = 'star';
  } else if (isRapidDrop) {
    badge = 'go';
  } else if (score >= 2) {
    badge = (projectedChange !== null && projectedChange.delta < -0.30) ? null : 'go';
  } else if (isRapidSpike || score <= -2) {
    badge = 'skip';
  } else {
    badge = null;
  }

  return {
    score,
    badge,
    factors: {
      vsAvg,
      vsRange,
      projectedChange,
      nearTermChange,
      rapidChange,
    },
  };
}

// Piecewise linear curve that scales the "is this delta meaningful?" floor
// with typical wait. Anchors:
//   typical ≤ 20  → 5 min   (short-wait rides: 5-min jitter shouldn't count)
//   typical = 50  → 10 min
//   typical = 90  → 15 min
//   typical = 120 → 20 min  (and capped here above)
// Between anchors the floor interpolates linearly, e.g. typical=40 → 8.3.
// Exported because both the Browse badge logic (here) and scanner.js (its
// JS port) need the exact same threshold to stay consistent.
export function absoluteFloorForTypical(typical: number): number {
  if (typical <= 20)  return 5;
  if (typical <= 50)  return 5  + (typical - 20) / 30 * 5;
  if (typical <= 90)  return 10 + (typical - 50) / 40 * 5;
  if (typical <= 120) return 15 + (typical - 90) / 30 * 5;
  return 20;
}
