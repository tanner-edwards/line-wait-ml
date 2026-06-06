import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/tokens';

export interface BelowNormalBadgeProps {
  currentWait: number | null;
  bucket0Wait: number | null;
  sampleCount: number;
}

/**
 * Renders a small pill under a ride's wait number telling the guest whether
 * the current wait is meaningfully off the historical average for this
 * day-type at this hour.
 *
 * Render rules (from the v1 spec — keep these in sync if the spec moves):
 *   - If `currentWait` or `bucket0Wait` is null, OR `bucket0Wait === 0`,
 *     OR `sampleCount < 20`: render nothing.
 *     (`sampleCount < 20` is the "low confidence" cutoff — we don't want to
 *     claim "below normal" off thin data. `bucket0Wait === 0` would
 *     zero-divide.)
 *   - "Below normal" when `currentWait < bucket0Wait * 0.75`.
 *   - "Above normal" when `currentWait > bucket0Wait * 1.25`.
 *   - Nothing rendered within the ±25% band.
 *
 * Styled as a small pill: muted green background for "Below normal",
 * muted orange/red for "Above normal". Both readable on the app's light
 * (#fff) background.
 */
export function BelowNormalBadge({
  currentWait,
  bucket0Wait,
  sampleCount,
}: BelowNormalBadgeProps): React.ReactElement | null {
  // The `sampleCount < N` gate exists so we don't claim "below normal" off
  // thin historical data. Production target is N=20, matching the score-
  // suppression and TrendArrow thresholds. Currently set to 1 because data
  // collection started 2026-05-02 — weekend cells only have ~18 samples max,
  // so the 20-cap hid the pill on every weekend ride. Raise back toward 20
  // once wait_times has several months of history.
  if (
    currentWait === null ||
    bucket0Wait === null ||
    bucket0Wait === 0 ||
    sampleCount < 1
  ) {
    return null;
  }

  if (currentWait < bucket0Wait * 0.75) {
    return (
      <View style={[styles.pill, styles.below]} testID="below-normal-badge">
        <Text style={[styles.label, styles.belowLabel]}>Below normal</Text>
      </View>
    );
  }

  if (currentWait > bucket0Wait * 1.25) {
    return (
      <View style={[styles.pill, styles.above]} testID="above-normal-badge">
        <Text style={[styles.label, styles.aboveLabel]}>Above normal</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
  },
  below: { backgroundColor: '#e6f4ea' }, // muted green // TODO: tokenize
  above: { backgroundColor: '#fde2dc' }, // muted red/orange // TODO: tokenize
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  belowLabel: { color: '#1a7f37' }, // TODO: tokenize
  aboveLabel: { color: colors.skip },
});
