// Layer 2 — Reality Check + Worth + Star.
//
// Spec: ~/.claude/specs/line-wait-ml/layer2-refine.md
//
// Takes Layer 1's RELATIVE verdict and refines it with the two things Layer 1
// deliberately ignores: ABSOLUTE minutes and ride WORTH. Layer 2 may only:
//   - SUPPRESS  (go→neutral, skip→neutral) — mute a relatively-real deal that's
//     meaningless in real minutes, or on an always-low filler ride.
//   - GRADE UP within the positive class (go→star) — a rare, big low.
// It may NEVER flip a sign (no skip→go, no neutral→go, no go→skip).
//
// Validated on the reality backtest over ~123k real decision points
// (cron/analysis/backtest.py): the worth filter mutes ~21k filler GOs at 0.0
// mean regret (pure noise, zero signal lost); STAR grades at 0.1 regret / 100%
// good; GO on worthy rides 89% good; SKIP 9% bad.
//
// The `reasons` object is emitted here so the deterministic "why this rating"
// copy (ride-detail hero card) is derived from the SAME numbers as the badge —
// badge and explanation can never contradict.

import { Ride, Verdict, VerdictReason, VerdictReasons } from '../types';
import { dealVerdict, DealResult } from './layer1';

export type { Verdict, VerdictReason, VerdictReasons };

// ── Dials (locked from the backtest sweep 2026-08-11) ──
const WORTH_MIN      = 20;    // p90 below this → filler; timing it is noise → mute badges
const STAR_P50_MIN   = 25;    // STAR only on genuinely high-demand rides (median wait ≥ this) —
                              // a low on a usually-short ride (p50 ~20) is common, not a rare find.
                              // 25 keeps headliners like Smugglers (p50 25); excludes Autopia (20).
const SKIP_FLOOR     = 15;    // a wait under this is never worth crossing the park to avoid
const STAR_DROP_PCT  = 0.30;  // STAR needs current ≥ this fraction below its typical-for-now
const GO_MIN_DROP    = 5;     // a Frame-A GO with a sub-5-min drop is trivial → mute

export interface VerdictResult {
  verdict: Verdict;
  deal: DealResult;            // the Layer 1 result this was refined from
  worthy: boolean;             // p90 ≥ WORTH_MIN
  suppressed: boolean;         // Layer 1 emitted go/skip, Layer 2 muted it to neutral
  star: boolean;
  reasons: VerdictReasons;
}

export function scoreVerdict(ride: Ride): VerdictResult {
  const deal = dealVerdict(ride);
  const st = ride.rideStats;
  const cur = ride.currentWait;
  const typical = deal.typical;

  const worthy = st != null && st.p90 >= WORTH_MIN;
  let verdict: Verdict = deal.verdict;
  // Which suppression rule (if any) muted a Layer 1 badge — drives neutral copy.
  let muted: 'filler' | 'trivial-drop' | 'short-to-skip' | null = null;

  if (cur != null && st != null) {
    // 1 — Worth filter (suppress). An always-low filler can look relatively
    //     low/high, but timing it is noise; you ride it whenever.
    if (verdict !== 'neutral' && !worthy) { verdict = 'neutral'; muted = 'filler'; }

    // 2 — Skip floor (suppress). A short wait is never worth avoiding.
    if (verdict === 'skip' && cur < SKIP_FLOOR) { verdict = 'neutral'; muted = 'short-to-skip'; }

    // 3 — Star (grade up). A genuinely rare low (≤ its own p10) that's ALSO
    //     well below typical-for-now — as a % of the ride's scale, so a 10-min
    //     drop stars on a 30-typical ride but not on an 80-typical one.
    if (
      verdict === 'go' && worthy &&
      st.p50 >= STAR_P50_MIN &&                   // genuinely high-demand — a low here IS rare
      cur <= st.p10 &&
      typical != null && cur <= (1 - STAR_DROP_PCT) * typical
    ) {
      verdict = 'star';
    }

    // 4 — Five-minute floor (tidy). A Frame-A-only GO with a trivial drop isn't
    //     a real deal. Frame-B ("today's low") GOs are exempt — a legitimate
    //     daily trough must survive even when the absolute gap is small.
    if (
      verdict === 'go' && deal.frameAGo && !deal.frameBGo &&
      typical != null && typical - cur < GO_MIN_DROP
    ) {
      verdict = 'neutral'; muted = 'trivial-drop';
    }
  }

  const suppressed = deal.verdict !== 'neutral' && verdict === 'neutral';
  const star = verdict === 'star';

  const reasons: VerdictReasons = {
    primary: primaryReason(verdict, star, deal, muted),
    current: cur ?? 0,
    typical,
    todayP30: deal.todayP30,
    todayP80: deal.todayP80,
    p10: st?.p10 ?? null,
    p90: st?.p90 ?? null,
    beatableSoon: deal.beatableSoon,
    betterWindowWait: deal.betterWindowWait,
    betterWindowInMin: deal.betterWindowInMin,
    star,
  };

  return { verdict, deal, worthy, suppressed, star, reasons };
}

function primaryReason(
  verdict: Verdict,
  star: boolean,
  deal: DealResult,
  muted: 'filler' | 'trivial-drop' | 'short-to-skip' | null,
): VerdictReason {
  if (star) return 'rare-low';
  if (verdict === 'go') return deal.frameBGo ? 'todays-low' : 'below-usual';
  if (verdict === 'skip') {
    const busy = deal.frameASkip || deal.ceiling;   // genuinely high for THIS ride
    // Normal-vs-typical but plummeting → "about to drop".
    if (!busy && deal.bigBeatableSoon) return 'dropping-soon';
    // Busy: reachability picks the copy — eases soon vs won't ease up today.
    if (deal.beatableSoon) return deal.ceiling ? 'at-ceiling' : 'high-vs-usual';
    return 'busy-no-relief';
  }
  // neutral — only a suppressed badge carries a reason; a plain neutral (incl.
  // "high for today but not actually busy", e.g. top of a flat/low day) is silent.
  return muted ?? 'none';
}
