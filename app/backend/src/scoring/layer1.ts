// Layer 1 — Deal Math (GO / SKIP / NEUTRAL). PURE RELATIVE position.
//
// Spec: ~/.claude/specs/line-wait-ml/layer1-deal-math.md
//
// Layer 1 answers ONE thing: is this wait meaningfully low / high / neither,
// RELATIVE to (A) the ride's time-of-day norm and (B) today's remaining shape?
// It deliberately ignores absolute minutes and ride worth — those are Layer 2.
//
// Iron law: two statistically-identical rides get the identical verdict.

import { Ride } from '../types';

export type DealVerdict = 'go' | 'skip' | 'neutral';

// ── Dials (calibrate against the snapshots; these are first-pass) ──
const MARGIN_PCT        = 0.20;  // "meaningful" move vs typical (relative only; 5-min floor → L2)
const GO_TODAY_PCTL     = 0.30;  // GO if current ≤ this percentile of today's remaining waits
const SKIP_TODAY_PCTL   = 0.80;  // SKIP needs current ≥ this pctl of today (tighter than GO = asymmetry)
const FLAT_SPREAD_MIN   = 10;    // if today's remaining range spans < this, Frame B is silent (flat day)
const SKIP_BEATABLE_MIN = 15;    // reachability-decayed minutes a better window must save to justify skip
const SKIP_BIG_BEATABLE_MIN = 25; // a BIG reachable drop justifies a skip even without Frame-A corroboration ("about to drop")
const ML_MAX_HORIZON    = 240;   // ML curve owns 0–4h; forecast owns beyond

// Reachability decay — how much a future window counts by how far out it is.
const DK_H = 4, DK_V = 0.7, DF_H = 8, DF_V = 0.3, D_FLOOR = 0.3;
function decay(min: number): number {
  const h = min / 60;
  if (h <= DK_H) return 1 - ((1 - DK_V) / DK_H) * h;
  return Math.max(D_FLOOR, DK_V - ((DK_V - DF_V) / (DF_H - DK_H)) * (h - DK_H));
}

export interface DealResult {
  verdict: DealVerdict;
  frameAGo: boolean; frameASkip: boolean;      // vs time-of-day typical
  frameBGo: boolean; frameBSkip: boolean;      // vs today's remaining shape
  ceiling: boolean;                            // current ≥ p90 (overpriced vs ever)
  beatableSoon: boolean;                       // a meaningfully-lower window is reachable soon
  bigBeatableSoon: boolean;                    // a BIG lower window is reachable soon ("about to drop")
  flatDay: boolean;                            // today's range too flat for Frame B
  todayP30: number | null; todayP80: number | null; typical: number | null;
}

function slotStart(r: Ride): number | null {
  const ts = (r.historicalBaseline ?? r.historicalAverage)?.buckets[0]?.timeSlot;
  if (!ts) return null;
  const [h, m] = ts.split('-')[0].split(':').map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
}

// Today's remaining predicted waits, each with minutes-from-now.
// ML curve (t10..t240) owns the near 4h; fullDayForecast owns beyond, remaining only.
function remainingCurve(r: Ride): { wait: number; dt: number }[] {
  const out: { wait: number; dt: number }[] = [];
  const p = r.prediction;
  if (p && p.confidence !== 'low') {
    const curve: [number, number][] = [
      [10, p.t10], [20, p.t20], [30, p.t30], [40, p.t40], [50, p.t50], [60, p.t60],
      [90, p.t90], [120, p.t120], [150, p.t150], [180, p.t180], [210, p.t210], [240, p.t240],
    ];
    for (const [dt, w] of curve) if (w != null) out.push({ wait: w, dt });
  }
  const mlMax = (p && p.confidence !== 'low') ? ML_MAX_HORIZON : 0;
  const ss = slotStart(r);
  if (r.fullDayForecast && ss != null) {
    for (const s of r.fullDayForecast) {
      if (s.wait == null || s.startMinutes <= ss) continue;   // remaining day only
      const dt = s.startMinutes - ss;
      if (dt <= mlMax) continue;                               // ML owns the near horizon
      out.push({ wait: s.wait, dt });
    }
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function dealVerdict(ride: Ride): DealResult {
  const cur = ride.currentWait;
  const st = ride.rideStats;
  const typical = (ride.historicalBaseline ?? ride.historicalAverage)?.buckets[0]?.wait ?? null;

  const empty: DealResult = {
    verdict: 'neutral', frameAGo: false, frameASkip: false, frameBGo: false, frameBSkip: false,
    ceiling: false, beatableSoon: false, bigBeatableSoon: false, flatDay: false, todayP30: null, todayP80: null, typical,
  };
  if (cur == null || ride.status !== 'OPERATING' || !st) return empty;

  const margin = typical != null ? typical * MARGIN_PCT : null;

  // ── Frame A — time-of-day norm ──
  const frameAGo   = typical != null && margin != null && cur <= typical - margin;
  const frameASkip = typical != null && margin != null && cur >= typical + margin;

  // ── Frame B — today's remaining shape ──
  const curve = remainingCurve(ride);
  const waits = curve.map(c => c.wait).sort((a, b) => a - b);
  let todayP30: number | null = null, todayP80: number | null = null;
  let frameBGo = false, frameBSkip = false, beatableSoon = false, bigBeatableSoon = false, flatDay = false;
  if (waits.length >= 2) {
    const spread = waits[waits.length - 1] - waits[0];
    flatDay = spread < FLAT_SPREAD_MIN;
    todayP30 = percentile(waits, GO_TODAY_PCTL);
    todayP80 = percentile(waits, SKIP_TODAY_PCTL);
    // reachability-decayed best improvement over the remaining curve
    let bestEff = 0;
    for (const c of curve) bestEff = Math.max(bestEff, (cur - c.wait) * decay(c.dt));
    beatableSoon = bestEff >= SKIP_BEATABLE_MIN;
    bigBeatableSoon = bestEff >= SKIP_BIG_BEATABLE_MIN;
    // GO can fire even on a flat day — if current sits at/below the bottom of
    // the remaining range, now IS the low point. But don't call a false PEAK on
    // a flat range, so the flat guard gates only the skip side.
    frameBGo = cur <= todayP30;
    if (!flatDay) frameBSkip = cur >= todayP80;
  }

  // ── p90 ceiling — overpriced vs this ride ever ──
  const ceiling = cur >= st.p90;

  // ── Combine — GO wins on conflict (never skip a ride that won't get better) ──
  let verdict: DealVerdict = 'neutral';
  if (frameAGo || frameBGo) {
    verdict = 'go';
  } else if (ceiling && beatableSoon) {
    // LOCKED 2026-08-11 (ceiling_beatable): at/above the p90 ceiling is only a
    // SKIP when a better window is actually reachable. A ride pinned at its
    // ceiling all day (busy day, no relief coming) is NOT a skip — you can't do
    // better, so it's neutral. Backtest: this cut bad skips 27% → 10%.
    verdict = 'skip';
  } else if (frameASkip && frameBSkip && beatableSoon) {
    verdict = 'skip';                                    // corroborated high + a better window is coming
  } else if (frameBSkip && bigBeatableSoon) {
    // "About to drop" — high for today AND a BIG reachable drop is coming, even
    // if current is near its historical typical (Frame A doesn't corroborate).
    // Catches the Tiana case: 45 now, ML falling to ~7 within a few hours.
    // Backtest: +3.6k skips at 74% good / 8% bad — a strict win.
    verdict = 'skip';
  }

  return { verdict, frameAGo, frameASkip, frameBGo, frameBSkip, ceiling, beatableSoon, bigBeatableSoon, flatDay, todayP30, todayP80, typical };
}
