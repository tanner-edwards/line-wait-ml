// Renders a small pill telling guests whether the current wait is meaningfully
// off the historical average for this day-type and hour.
//
// Render rules (keep in sync with v1 spec):
//   - null currentWait, null bucket0Wait, bucket0Wait === 0, sampleCount < 1 → nothing
//   - currentWait < bucket0Wait * 0.75 → "Below normal" (go)
//   - currentWait > bucket0Wait * 1.25 → "Above normal" (skip)
//   - within ±25% band → nothing
//
import React from 'react';
import { MIN_BUCKET_SAMPLE_COUNT } from '../scoreConstants';
import { Pill } from './Pill';

export interface BelowNormalBadgeProps {
  currentWait: number | null;
  bucket0Wait: number | null;
  sampleCount: number;
}

export function BelowNormalBadge({
  currentWait,
  bucket0Wait,
  sampleCount,
}: BelowNormalBadgeProps): React.ReactElement | null {
  if (
    currentWait === null ||
    bucket0Wait === null ||
    bucket0Wait === 0 ||
    sampleCount < MIN_BUCKET_SAMPLE_COUNT
  ) {
    return null;
  }

  if (currentWait < bucket0Wait * 0.75) {
    return <Pill variant="go" label="Below normal" testID="below-normal-badge" />;
  }

  if (currentWait > bucket0Wait * 1.25) {
    return <Pill variant="skip" label="Above normal" testID="above-normal-badge" />;
  }

  return null;
}
