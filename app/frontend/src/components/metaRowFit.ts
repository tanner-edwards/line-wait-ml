// Shared fit check for the one-line meta row (badge · wait pill · walk time)
// on rec cards and Discover rows. Measures the row, the badge, the walk time
// and off-screen copies of the wait pill at natural width (the visible one
// gets squeezed by the flex row). Steps the wait label down instead of
// letting it ellipsize:
//
//   "70 min wait" → "70 min" → "70m"
//
// "Walk On" steps down differently: icon + text → text → text ellipsized →
// icon alone once less than WALK_ON_MIN_TEXT_W is left (a bare "…" is useless).
// No posted wait has no short forms.

import { useState } from 'react';
import { LayoutChangeEvent } from 'react-native';

export type WaitFit = 'full' | 'short' | 'compact';

const MIN_WAIT = / min wait$/;

/** The label at a fit level. */
export function fitWaitLabel(label: string, fit: WaitFit): string {
  if (!MIN_WAIT.test(label) || fit === 'full') return label;
  return fit === 'short' ? label.replace(MIN_WAIT, ' min') : label.replace(MIN_WAIT, 'm');
}

/** Narrowest pill that still shows a few letters of "Walk On". */
export const WALK_ON_MIN_TEXT_W = 68;

export type WalkOnMode = 'full' | 'text' | 'icon';

/** What the Walk On pill shows: with the label measured as "full" (icon + text)
 * and "short" (text only), `avail` is the width the pill has to work with. */
export function walkOnMode(fit: WaitFit, avail: number): WalkOnMode {
  if (fit === 'full') return 'full';
  return avail < WALK_ON_MIN_TEXT_W ? 'icon' : 'text';
}

/** Has a short form worth measuring. */
export function hasShortForms(label: string | null): label is string {
  return label !== null && MIN_WAIT.test(label);
}

type OnLayout = (e: LayoutChangeEvent) => void;

export function useMetaRowFit(gap: number, itemCount: number): {
  onRow: OnLayout;
  onBadge: OnLayout;
  /** Off-screen full-label pill. */
  onLabel: OnLayout;
  /** Off-screen short-label ("70 min") pill. */
  onShortLabel: OnLayout;
  onWalk: OnLayout;
  fit: WaitFit;
  /** Width left for the wait pill once the other items and gaps are placed. */
  avail: number;
} {
  const [rowW, setRowW] = useState(0);
  const [badgeW, setBadgeW] = useState(0);
  const [walkW, setWalkW] = useState(0);
  const [labelW, setLabelW] = useState(0);
  const [shortW, setShortW] = useState(0);
  const w = (set: (n: number) => void): OnLayout => e => set(e.nativeEvent.layout.width);

  const rest = badgeW + walkW + gap * Math.max(itemCount - 1, 0);
  const fit: WaitFit =
    rowW === 0 || labelW === 0 || rest + labelW <= rowW ? 'full'
    : shortW === 0 || rest + shortW <= rowW ? 'short'
    : 'compact';
  return {
    onRow: w(setRowW),
    onBadge: w(setBadgeW),
    onLabel: w(setLabelW),
    onShortLabel: w(setShortW),
    onWalk: w(setWalkW),
    fit,
    avail: rowW === 0 ? Infinity : rowW - rest,
  };
}
