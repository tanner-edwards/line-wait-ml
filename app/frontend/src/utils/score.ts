import { Ride } from '../types';

export type Badge = 'star' | 'go' | 'skip' | null;

export interface FactorBreakdown {
  vsAvg:           { delta: number; points: number } | null; // null = skipped (bucket0.wait === 0)
  vsRange:         { pct: number;  points: number } | null;  // null = skipped (no rideStats or range < 5)
  projectedChange: { delta: number; points: number } | null; // null = skipped (currentWait is 0 or lateAvg missing)
  nearTermChange:  { delta: number; points: number } | null; // null = skipped (bucket1 missing or currentWait is 0)
}

export interface ScoreResult {
  score:   number;
  badge:   Badge;
  factors: FactorBreakdown;
}

const SUPPRESSED: ScoreResult = {
  score: 0,
  badge: null,
  factors: {
    vsAvg: null,
    vsRange: null,
    projectedChange: null,
    nearTermChange: null,
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

  if (bucket0.sampleCount < 20) return SUPPRESSED;

  // --- Factor 1: current wait vs. t+0 bucket average (max ±2) ---
  let vsAvg: FactorBreakdown['vsAvg'];
  let f1 = 0;
  if (bucket0.wait !== null && bucket0.wait !== 0) {
    const delta = (currentWait - bucket0.wait) / bucket0.wait;
    // Require ≥5 min absolute difference to avoid noise on short-wait rides
    if (Math.abs(currentWait - bucket0.wait) >= 5) {
      if      (delta < -0.25) f1 = +2;
      else if (delta < -0.10) f1 = +1;
      else if (delta >  0.25) f1 = -2;
      else if (delta >  0.10) f1 = -1;
    }
    vsAvg = { delta, points: f1 };
  } else {
    vsAvg = null; // bucket0.wait is 0 or null — skip Factor 1
  }

  // --- Factor 2: position in p10/p90 range (max ±2) ---
  let vsRange: FactorBreakdown['vsRange'] = null;
  let f2 = 0;
  if (rideStats != null) {  // != catches undefined from legacy fixtures too
    const range = rideStats.p90 - rideStats.p10;
    if (range >= 5) {
      const pct = Math.max(0, Math.min(1, (currentWait - rideStats.p10) / range));
      if      (currentWait <= rideStats.p10)  f2 = +2;
      else if (pct < 0.25)                    f2 = +1;
      else if (currentWait >= rideStats.p90)  f2 = -2;
      else if (pct > 0.75)                    f2 = -1;
      vsRange = { pct, points: f2 };
    }
    // else range < 5 — skip Factor 2, vsRange stays null
  }
  // rideStats === null — skip Factor 2

  // --- Factor 3: projected change, anchored early window vs late window (max ±2) ---
  // earlyAvg = avg(currentWait, t+30)  lateAvg = avg(t+90, t+120)
  // Anchoring to currentWait (not t+0 historical avg) ensures the forecast starts from ground truth.
  // Positive delta (rising) → go now before it gets worse.
  // Negative delta (dropping) → skip / wait for it to improve.
  let projectedChange: FactorBreakdown['projectedChange'] = null;
  let f3 = 0;
  const b1w = bucket1.wait;
  const b3w = bucket3.wait, b4w = bucket4.wait;
  const earlyAvg = b1w !== null ? (currentWait + b1w) / 2 : currentWait;
  const lateAvg  = (b3w !== null && b4w !== null) ? (b3w + b4w) / 2 : (b3w ?? b4w);
  if (currentWait !== 0 && lateAvg !== null) {
    const delta = (lateAvg - earlyAvg) / earlyAvg;
    // Require ≥10 min absolute change to avoid noise on low-wait rides (e.g. carousels at 5→6 min)
    if (Math.abs(lateAvg - earlyAvg) >= 10) {
      if      (delta < -0.25) f3 = -2;
      else if (delta < -0.10) f3 = -1;
      else if (delta >  0.25) f3 = +2;
      else if (delta >  0.10) f3 = +1;
    }
    projectedChange = { delta, points: f3 };
  }

  // --- Factor 4: near-term change, current → t+30 (max ±1) ---
  // Rising at t+30 → go now before it gets worse. Dropping → skip, improving soon.
  // Threshold: max(10 min, 20% of current wait) — avoids noise on short-wait rides.
  let nearTermChange: FactorBreakdown['nearTermChange'] = null;
  let f4 = 0;
  if (b1w !== null && currentWait > 0) {
    const minuteDelta = b1w - currentWait; // positive = rising, negative = dropping
    const threshold = Math.max(10, currentWait * 0.20);
    if (Math.abs(minuteDelta) >= threshold) {
      f4 = minuteDelta > 0 ? +1 : -1;
    }
    nearTermChange = { delta: minuteDelta / currentWait, points: f4 };
  }

  const score = f1 + f2 + f3 + f4;

  // Gold star: rare exceptional opportunity. All three conditions must hold.
  // Overrides the score-based badge; bypasses the "go" suppression rule.
  //   1. currentWait within 15% of historical floor (rideStats.p10)
  //   2. currentWait >30% below the time-slot average (vsAvg.delta < -0.30)
  //   3. the line is rising — the dip is fleeting (projectedChange.delta > 0.10)
  const isGoldStar =
    rideStats != null &&  // catches undefined from legacy fixtures too
    currentWait <= rideStats.p10 * 1.15 &&
    vsAvg !== null && vsAvg.delta < -0.30 &&
    projectedChange !== null && projectedChange.delta > 0.10;

  let badge: Badge;
  if (isGoldStar) {
    badge = 'star';
  } else if (score >= 2) {
    // Suppress "go" when a >30% cheaper window is coming in the 2hr horizon
    badge = (projectedChange !== null && projectedChange.delta < -0.30) ? null : 'go';
  } else if (score <= -2) {
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
    },
  };
}
