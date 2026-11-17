// Shared fit check for the one-line meta row (badge · wait pill · walk time)
// on rec cards and Discover rows. Measures the row, the badge, the walk time
// and off-screen copies of the wait pill at natural width (the visible one
// gets squeezed by the flex row). Steps the wait label down instead of
// letting it ellipsize:
//
//   "70 min wait" → "70 min" → "70m"
//
// Other labels (Walk On, No posted wait) have no short forms.

import { useState } from 'react';
import { LayoutChangeEvent } from 'react-native';

export type WaitFit = 'full' | 'short' | 'compact';

const MIN_WAIT = / min wait$/;

/** The label at a fit level. */
export function fitWaitLabel(label: string, fit: WaitFit): string {
  if (!MIN_WAIT.test(label) || fit === 'full') return label;
  return fit === 'short' ? label.replace(MIN_WAIT, ' min') : label.replace(MIN_WAIT, 'm');
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
  };
}
