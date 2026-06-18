// Pill — unified badge/pill primitive.
//
// Icon mode (no label): renders a Lucide icon in the variant's color.
//   star → Star (filled gold)  |  go → CircleCheck (green)  |  skip → OctagonX (red)
//
// Pill mode (with label): small text pill.
//   go   → goBg bg, go text    (Below normal)
//   skip → skipBg bg, skip text (Above normal)
//   star → starBg bg, star text

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CircleCheck, OctagonX, Star } from 'lucide-react-native';
import { colors, radius } from '../theme/tokens';

export type PillVariant = 'star' | 'go' | 'skip' | 'neutral';

interface PillProps {
  variant: PillVariant;
  label?: string;
  testID?: string;
}

const PILL_BG: Record<PillVariant, string> = {
  star:    colors.starBg,
  go:      colors.goBg,
  skip:    colors.skipBg,
  neutral: 'transparent',
};

const PILL_TEXT: Record<PillVariant, string> = {
  star:    colors.star,
  go:      colors.go,
  skip:    colors.skip,
  neutral: colors.textTertiary,
};

export function Pill({ variant, label, testID }: PillProps): React.ReactElement | null {
  if (label) {
    return (
      <View style={[styles.pill, { backgroundColor: PILL_BG[variant] }]} testID={testID}>
        <Text style={[styles.pillText, { color: PILL_TEXT[variant] }]}>{label}</Text>
      </View>
    );
  }

  // Icon mode — Lucide icon in variant color, no wrapper circle needed
  if (variant === 'star') {
    return (
      <View style={styles.icon} testID={testID ?? 'badge-star'}>
        <Star size={18} color={colors.star} fill={colors.star} />
      </View>
    );
  }
  if (variant === 'go') {
    return (
      <View style={styles.icon} testID={testID ?? 'badge-go'}>
        <CircleCheck size={20} color={colors.go} />
      </View>
    );
  }
  if (variant === 'skip') {
    return (
      <View style={styles.icon} testID={testID ?? 'badge-skip'}>
        <OctagonX size={20} color={colors.skip} />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  icon: {
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
