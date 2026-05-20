import { Ride } from '../types';

export type Badge = 'go' | 'skip' | null;

export interface FactorBreakdown {
  vsAvg:   { delta: number; points: number } | null; // null = skipped (bucket0.wait === 0)
  vsRange: { pct: number;  points: number } | null;  // null = skipped (no rideStats or range < 5)
  trend:   { direction: 'up' | 'down' | 'stable'; points: number };
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
    trend: { direction: 'stable', points: 0 },
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
  const bucket2 = historicalAverage.buckets[2];

  if (bucket0.sampleCount < 20) return SUPPRESSED;

  // --- Factor 1: current wait vs. t+0 bucket average (max ±2) ---
  let vsAvg: FactorBreakdown['vsAvg'];
  let f1 = 0;
  if (bucket0.wait !== null && bucket0.wait !== 0) {
    const delta = (currentWait - bucket0.wait) / bucket0.wait;
    if      (delta < -0.25) f1 = +2;
    else if (delta < -0.10) f1 = +1;
    else if (delta >  0.25) f1 = -2;
    else if (delta >  0.10) f1 = -1;
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

  // --- Factor 3: trend modifier (max ±1) ---
  let trendDirection: 'up' | 'down' | 'stable' = 'stable';
  let f3 = 0;
  if (bucket0.wait !== null && bucket2.wait !== null && bucket0.wait !== 0) {
    if      (bucket2.wait > bucket0.wait * 1.1) { trendDirection = 'up';   f3 = +1; }
    else if (bucket2.wait < bucket0.wait * 0.9) { trendDirection = 'down'; f3 = -1; }
  }

  const score = f1 + f2 + f3;
  const badge: Badge = score >= 2 ? 'go' : score <= -2 ? 'skip' : null;

  return {
    score,
    badge,
    factors: {
      vsAvg,
      vsRange,
      trend: { direction: trendDirection, points: f3 },
    },
  };
}
