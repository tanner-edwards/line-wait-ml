import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Badge } from '../types';

interface RecommendationBadgeProps {
  badge: Badge;
}

export function RecommendationBadge({ badge }: RecommendationBadgeProps): React.ReactElement | null {
  if (badge === null) return null;

  if (badge === 'star') {
    return (
      <View style={styles.starCircle} testID="badge-star">
        <Text style={styles.starText}>★</Text>
      </View>
    );
  }

  if (badge === 'go') {
    return (
      <View style={styles.goCircle} testID="badge-go">
        <Text style={styles.goText}>✓</Text>
      </View>
    );
  }

  // 'skip' — octagon approximated by a rounded square rotated 22.5°.
  // The container clips overflow so the rotation doesn't affect layout.
  return (
    <View style={styles.skipWrapper} testID="badge-skip">
      <View style={styles.skipOctagon}>
        <Text style={styles.skipText}>✕</Text>
      </View>
    </View>
  );
}

const SIZE = 20;
const HALF = SIZE / 2;

const styles = StyleSheet.create({
  starCircle: {
    width: SIZE,
    height: SIZE,
    borderRadius: HALF,
    backgroundColor: '#d4af37',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  starText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: SIZE,
  },
  goCircle: {
    width: SIZE,
    height: SIZE,
    borderRadius: HALF,
    backgroundColor: '#1a7f37',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  goText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: SIZE,
  },
  // Fixed-size container prevents the rotated child from affecting layout.
  skipWrapper: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    overflow: 'hidden',
  },
  skipOctagon: {
    width: SIZE,
    height: SIZE,
    borderRadius: 4,
    backgroundColor: '#c41e3a',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '22.5deg' }],
  },
  skipText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    transform: [{ rotate: '-22.5deg' }],
  },
});
