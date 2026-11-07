// "Just jumped" copy flag — copy only, never changes the verdict.
//
// Spec: ~/.claude/specs/line-wait-ml/upjump-wording.md
//
// Right after a ride's posted wait jumps up, the direction classifier's
// p_fall_60 says whether the jump will hold. In the decision-level replay
// (served forecasts 10-27 -> 11-03, 1,275 up-jumps; error-slices/replay), on
// NEUTRAL/SKIP verdicts with p_fall_60 >= 0.7 the jump was more than halfway
// gone an hour later 75% of the time (NEUTRAL 68%, SKIP 79%, 7 of 8 days),
// against a 63% base rate. On GO it was a coin flip, so GO/star never fire.

import type { Verdict } from '../types';
import type { MLPredictionDoc } from '../mlPredictions';
import { normalizeWalkOn } from '../walkOn';

export const P_FALL_JUMP_THRESHOLD = 0.7;
// Jump = rise of at least max(JUMP_MIN, JUMP_P50_SHARE x the ride's typical
// wait) between the forecast's poll and the one before it (owner rule:
// relative to the ride, with a small floor).
export const JUMP_MIN = 10;
export const JUMP_P50_SHARE = 0.25;

export interface JumpEaseInput {
  verdict: Verdict;
  mlPred: Pick<MLPredictionDoc, 'wait_now' | 'wait_prev' | 'p_fall_60'> | undefined;
  p50: number | null | undefined;
  currentWait: number | null;   // live posted value (raw)
}

export function jumpEase({ verdict, mlPred, p50, currentWait }: JumpEaseInput): boolean {
  if (verdict !== 'neutral' && verdict !== 'skip') return false;
  if (!mlPred) return false;
  const { wait_now: now, wait_prev: prev, p_fall_60: pFall } = mlPred;
  if (typeof now !== 'number' || typeof prev !== 'number' || typeof pFall !== 'number') return false;
  if (pFall < P_FALL_JUMP_THRESHOLD) return false;
  const threshold = Math.max(JUMP_MIN, JUMP_P50_SHARE * (p50 ?? 0));
  if (now - prev < threshold) return false;
  // Disney may already have re-posted it back down since our poll; then it
  // isn't "just jumped" any more.
  const live = normalizeWalkOn(currentWait);
  return live != null && live - prev >= threshold;
}
