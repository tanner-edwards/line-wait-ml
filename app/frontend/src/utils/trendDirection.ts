// Shared trend-direction helper. Single source of truth for the
// "Rising / Dropping / Steady" label, the TrendArrow icon, and the
// TrendCaption sentence — so they can't contradict each other on the
// same screen.
//
// --- Why this is more than a single bucket comparison ---
//
// Naive: compare currentWait to bucket[t+120]. Two problems:
//   1. One future point is noisy — a single bad bucket flips the label.
//   2. It ignores what's actually happening right now (real observations).
//
// Better: combine two signals into one delta.
//
//   pastDelta   = currentWait − recentWait
//     A real observation. Captures whether the line is already moving
//     today (e.g. a parade just dumped 30 people into Pirates).
//
//   futureDelta = avg(bucket3, bucket4) − avg(currentWait, bucket1)
//     The same early-vs-late averaging Factor 3 uses in scoreRide.
//     Uses 4 of our 5 future points, smooths over a single weird bucket,
//     and stays anchored to currentWait on the early side so it reflects
//     where the ride actually is now (not just historical patterns).
//
// Combined delta with two corrections:
//
//   1. Opposing signals → future wins.
//      When past and future pull in opposite directions (one positive, one
//      negative), the sum would cancel toward zero and produce a misleading
//      'stable'. Instead we trust the forward-looking signal: it describes
//      what the guest will actually face when they arrive, not what already
//      happened. The past is informative only when it reinforces the future.
//
//   2. Floor guard (currentWait ≤ 10 min).
//      At walk-on territory, a recent drop from 15 → 5 is noise: the ride
//      is already at its practical floor and can't meaningfully improve
//      further. Suppressing pastDelta avoids a "Dropping" label that implies
//      more headroom than exists.
//
// When past and future agree (same sign), combined = futureDelta + 0.4 * pastDelta.
// The 0.4 weight keeps the historical future curve as the primary signal while
// letting a real recent move nudge the label in borderline cases.

/**
 * Direction the wait is heading, combining recent past observations with
 * the historical-average future curve.
 */
export interface TrendInput {
  /** Wait right now (or wait-at-close for DOWN rides). */
  currentWait: number | null;
  /** Wait from the most recent past observation (e.g. ~20 min ago). Null = no past data. */
  recentWait: number | null;
  /** Historical-average wait at t+30. */
  bucket1Wait: number | null;
  /** Historical-average wait at t+90. */
  bucket3Wait: number | null;
  /** Historical-average wait at t+120. */
  bucket4Wait: number | null;
}

/**
 * Returns 'up' / 'down' / 'stable', or null when there's no usable signal at all.
 *
 * Null-fallback rules:
 *   - currentWait null         → null (can't compare from nothing)
 *   - past missing             → use future-only
 *   - all future buckets null  → use past-only
 *   - everything missing       → null
 */
export function trendDirection(input: TrendInput): 'up' | 'down' | 'stable' | null {
  const { currentWait, recentWait, bucket1Wait, bucket3Wait, bucket4Wait } = input;
  if (currentWait === null) return null;

  // Past delta — actual movement since the last poll.
  // Suppressed at the floor (≤ 10 min): a drop from 15 → 5 is hitting the
  // walk-on floor, not a signal of further improvement.
  const rawPastDelta = recentWait !== null ? currentWait - recentWait : null;
  const pastDelta = (rawPastDelta !== null && currentWait > 10) ? rawPastDelta : null;

  // Future delta — early-window vs late-window historical averages.
  // Mirrors scoreRide's Factor 3. earlyAvg always anchors on currentWait
  // (so the signal reflects where the ride is, not the historical t+0 avg).
  const earlyAvg = bucket1Wait !== null ? (currentWait + bucket1Wait) / 2 : currentWait;
  let lateAvg: number | null;
  if (bucket3Wait !== null && bucket4Wait !== null) lateAvg = (bucket3Wait + bucket4Wait) / 2;
  else if (bucket4Wait !== null)                    lateAvg = bucket4Wait;
  else if (bucket3Wait !== null)                    lateAvg = bucket3Wait;
  else                                              lateAvg = null;
  const futureDelta = lateAvg !== null ? lateAvg - earlyAvg : null;

  // No usable signal in either direction.
  if (pastDelta === null && futureDelta === null) return null;

  // Combine signals. When past and future oppose (one positive, other negative),
  // trust the future — it describes what the guest will face on arrival.
  // When they agree, boost by a fraction of the past observation.
  const opposing = pastDelta !== null && futureDelta !== null && pastDelta * futureDelta < 0;
  let combined: number;
  if (futureDelta === null) {
    // Future unavailable — past only, with reduced confidence.
    combined = (pastDelta ?? 0) * 0.4;
  } else if (pastDelta === null || opposing) {
    // No past, or signals pull in opposite directions — forward curve wins.
    combined = futureDelta;
  } else {
    // Aligned — future dominates; past provides a measured boost.
    combined = futureDelta + 0.4 * pastDelta;
  }

  if (Math.abs(combined) < 5) return 'stable';
  return combined > 0 ? 'up' : 'down';
}
