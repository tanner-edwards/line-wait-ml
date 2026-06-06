// Base card primitive. Phase 3 composes this into ride rows, rec cards,
// and upcoming-window tiles — don't use it for those in Phase 2.
//
// variant: default (elevated)  |  highlight (status wash + left accent)  |  flat (no shadow)
// accent: left-border color, used with highlight to signal go/skip/star state

import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, shadows, spacing } from '../theme/tokens';

interface CardProps {
  variant?: 'default' | 'highlight' | 'flat';
  accent?: string;
  style?: ViewStyle;
  children: React.ReactNode;
  testID?: string;
}

export function Card({
  variant = 'default',
  accent,
  style,
  children,
  testID,
}: CardProps): React.ReactElement {
  return (
    <View
      style={[
        styles.card,
        variant === 'highlight' && styles.highlight,
        variant === 'flat' && styles.flat,
        accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : undefined,
        style,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
    ...shadows.card,
  },
  highlight: {
    backgroundColor: colors.goBg,
    borderColor: colors.go,
  },
  flat: {
    shadowOpacity: 0,
    elevation: 0,
  },
});
