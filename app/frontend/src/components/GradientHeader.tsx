// App header band. Used on Home, Recommendations, and Profile.
//
// Renders a flat solid green (colors.gradientFrom) with a title in Lora
// inverse-white, plus an optional subtitle and a right-aligned slot for
// buttons/actions. The name "Gradient" is historical — the header used to
// be a blue→purple gradient before the June 2026 palette migration. Kept
// the export name so callers don't churn.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme/tokens';

interface GradientHeaderProps {
  title: string;
  /** String is auto-styled inverse-muted. Pass a ReactNode for custom interactive content. */
  subtitle?: React.ReactNode;
  /** Buttons or actions floated to the right. */
  right?: React.ReactNode;
}

export function GradientHeader({ title, subtitle, right }: GradientHeaderProps): React.ReactElement {
  return (
    <View style={styles.header}>
      <View style={styles.inner}>
        <View style={styles.left}>
          <Text style={styles.title}>{title}</Text>
          {subtitle != null ? (
            typeof subtitle === 'string' ? (
              <Text style={styles.subtitle}>{subtitle}</Text>
            ) : (
              subtitle
            )
          ) : null}
        </View>
        {right != null ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

export const gradientHeaderTextStyles = StyleSheet.create({
  subtitle: {
    fontSize: 13,
    color: colors.textInverseMuted,
    marginTop: 2,
  },
  subtitleActive: {
    fontSize: 13,
    color: colors.textInverse,
    marginTop: 2,
  },
});

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.gradientFrom,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  left: { flex: 1 },
  title: {
    ...typography.screenTitle,
    color: colors.textInverse,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textInverseMuted,
    marginTop: spacing.xs,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
