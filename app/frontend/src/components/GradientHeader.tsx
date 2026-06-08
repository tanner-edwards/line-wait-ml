// Park Horizon gradient header band. Used on Home, Recommendations, and Profile.
//
// Renders a blue → purple diagonal gradient with a title (Lora display font,
// inverse white) and optional subtitle + right slot for buttons / actions.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
    <LinearGradient
      colors={[colors.gradientFrom, colors.gradientTo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
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
    </LinearGradient>
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
  gradient: {
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
