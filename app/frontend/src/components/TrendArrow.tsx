import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import { colors } from '../theme/tokens';
import { VerdictTrajectory } from '../types';

export type RowTrendDirection = 'up' | 'down';

/**
 * Map the server verdict's ML trajectory to a row arrow direction. This is the
 * single source of truth for the list-row trend — no local recompute from
 * buckets. Steady (and absent/low-confidence → null) is suppressed per the
 * "each signal silent in its neutral middle" rule.
 *   rising | trough → 'up' (Rising)     falling | peak → 'down' (Dropping)
 */
export function trajectoryDirection(traj: VerdictTrajectory): RowTrendDirection | null {
  if (traj === 'rising' || traj === 'trough') return 'up';
  if (traj === 'falling' || traj === 'peak') return 'down';
  return null;
}

interface TrendArrowProps {
  direction: RowTrendDirection;
}

/**
 * Direction-of-change indicator next to a ride's wait. NEUTRAL color — the
 * arrow shape carries direction; the verdict chip carries good/bad. Only
 * rendered for an actionable up/down direction (callers suppress the rest).
 */
export function TrendArrow({ direction }: TrendArrowProps): React.ReactElement {
  const Icon = direction === 'up' ? TrendingUp : TrendingDown;
  const color = direction === 'up' ? colors.trendUp : colors.trendDown;
  return (
    <View style={styles.container} testID={`trend-arrow-${direction}`}>
      <Icon size={14} color={color} strokeWidth={2.5} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginLeft: 6,
    paddingHorizontal: 3,
    paddingVertical: 2,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
