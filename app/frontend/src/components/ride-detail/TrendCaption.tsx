// Small italic sentence below the trend graph — translates the combined
// past+future signal into plain language. Uses the same `trendDirection`
// helper as the trend label and TrendArrow so they can't disagree.

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors } from '../../theme/tokens';
import { trendDirection } from '../../utils/trendDirection';

interface Props {
  anchorWait: number | null;
  isDown: boolean;
  recentWait: number | null;
  bucket1Wait: number | null;
  bucket3Wait: number | null;
  bucket4Wait: number | null;
}

export function TrendCaption({
  anchorWait,
  isDown,
  recentWait,
  bucket1Wait,
  bucket3Wait,
  bucket4Wait,
}: Props): React.ReactElement | null {
  if (isDown) {
    return <Text style={styles.tinyHint}>Future grayed — we don't have a reopen estimate yet.</Text>;
  }
  const dir = trendDirection({
    currentWait: anchorWait,
    recentWait,
    bucket1Wait,
    bucket3Wait,
    bucket4Wait,
  });
  if (dir === null) return null;
  if (dir === 'stable') {
    return <Text style={styles.tinyHint}>Roughly flat over the next 2 hours.</Text>;
  }
  if (dir === 'up') {
    return <Text style={styles.tinyHint}>Trending up over the next 2 hours — sooner is better.</Text>;
  }
  return <Text style={styles.tinyHint}>Trending down — a better window may be coming.</Text>;
}

const styles = StyleSheet.create({
  tinyHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 6,
    fontStyle: 'italic',
  },
});
