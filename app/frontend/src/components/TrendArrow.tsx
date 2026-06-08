import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react-native';
import { colors } from '../theme/tokens';
import { trendDirection, TrendInput } from '../utils/trendDirection';

export interface TrendArrowProps extends TrendInput {
  /**
   * When true, the arrow renders with a dashed border — signals a low-
   * confidence estimate (thin historical data) without changing the direction.
   */
  lowConfidence: boolean;
}

/**
 * Direction-of-change indicator next to a ride's current wait.
 * Delegates the actual decision to the shared `trendDirection` helper, so the
 * arrow, the "Rising/Dropping/Steady" label, and the TrendCaption sentence
 * all agree by construction.
 */
export function TrendArrow({
  lowConfidence,
  ...input
}: TrendArrowProps): React.ReactElement | null {
  const direction = trendDirection(input);
  if (direction === null) return null;

  let Icon: typeof TrendingDown;
  let color: string;

  if (direction === 'down') {
    Icon = TrendingDown;
    color = colors.go;
  } else if (direction === 'up') {
    Icon = TrendingUp;
    color = colors.skip;
  } else {
    Icon = Minus;
    color = colors.textSecondary;
  }

  return (
    <View
      style={[styles.container, lowConfidence && styles.lowConfidence]}
      testID={`trend-arrow-${direction}${lowConfidence ? '-low-conf' : ''}`}
    >
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
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lowConfidence: {
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
});
