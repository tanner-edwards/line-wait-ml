import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react-native';
import { colors } from '../theme/tokens';

export interface TrendArrowProps {
  bucket0Wait: number | null;
  bucket2Wait: number | null;
  /**
   * When true, the arrow renders with a dashed border — signals a low-
   * confidence estimate (thin historical data) without changing the direction.
   */
  lowConfidence: boolean;
}

/**
 * Direction-of-change indicator next to a ride's current wait.
 * Compares the historical-average bucket at t+0 to t+60 (next hour).
 *
 * Render rules:
 *   - null bucket0Wait / bucket2Wait, or bucket0Wait === 0 → null
 *   - bucket2Wait < bucket0Wait * 0.9 → TrendingDown (green — good, wait dropping)
 *   - bucket2Wait > bucket0Wait * 1.1 → TrendingUp   (red — bad, wait rising)
 *   - ±10% band → Minus (stable, gray)
 */
export function TrendArrow({
  bucket0Wait,
  bucket2Wait,
  lowConfidence,
}: TrendArrowProps): React.ReactElement | null {
  if (bucket0Wait === null || bucket2Wait === null || bucket0Wait === 0) {
    return null;
  }

  let Icon: typeof TrendingDown;
  let color: string;
  let direction: 'down' | 'up' | 'stable';

  if (bucket2Wait < bucket0Wait * 0.9) {
    Icon = TrendingDown;
    color = colors.go;
    direction = 'down';
  } else if (bucket2Wait > bucket0Wait * 1.1) {
    Icon = TrendingUp;
    color = colors.skip;
    direction = 'up';
  } else {
    Icon = Minus;
    color = colors.textSecondary;
    direction = 'stable';
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
