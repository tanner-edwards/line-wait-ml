// App header band. Used on Home, Recommendations, and Profile.
//
// Renders a flat solid green (colors.gradientFrom) with a title in Lora
// inverse-white, plus an optional subtitle and a right-aligned slot for
// buttons/actions. The name "Gradient" is historical — the header used to
// be a blue→purple gradient before the June 2026 palette migration. Kept
// the export name so callers don't churn.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { colors, spacing, typography } from '../theme/tokens';

interface GradientHeaderProps {
  title: string;
  /** String is auto-styled inverse-muted. Pass a ReactNode for custom interactive content. */
  subtitle?: React.ReactNode;
  /** Buttons or actions floated to the right. */
  right?: React.ReactNode;
  /** Pushed screens: shows "‹ backLabel" above the title. */
  back?: { label: string; onPress: () => void };
  /** Full-width content under the title row, inside the green (e.g. search). */
  bottom?: React.ReactNode;
  /** Set when a ContentPanel follows — extends the green so the panel's
   *  rounded top can overlap it without covering header content. */
  panelBelow?: boolean;
}

export function GradientHeader({ title, subtitle, right, back, bottom, panelBelow }: GradientHeaderProps): React.ReactElement {
  return (
    <View style={[styles.header, panelBelow && styles.headerWithPanel]}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          onPress={back.onPress}
          hitSlop={8}
          style={styles.back}
          testID="header-back"
        >
          <ChevronLeft size={20} color={colors.textInverse} />
          <Text style={styles.backLabel}>{back.label}</Text>
        </Pressable>
      ) : null}
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
      {bottom != null ? <View style={styles.bottom}>{bottom}</View> : null}
    </View>
  );
}

/** How far a ContentPanel's rounded top tucks up under the header. */
export const PANEL_OVERLAP = 20;

/**
 * Cream content area with a rounded top that overlaps the green header above
 * it. Pair with <GradientHeader panelBelow>. Clips scrolled content to the
 * rounded corners.
 */
export function ContentPanel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View style={styles.panel}>{children}</View>;
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
    // Tighter on top — the green status strip above already reads as
    // breathing room, so a full 16 looked like a gap.
    paddingTop: spacing.xs,
    paddingBottom: spacing.base,
  },
  headerWithPanel: {
    paddingBottom: spacing.base + PANEL_OVERLAP,
  },
  bottom: {
    marginTop: spacing.base,
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
  panel: {
    flex: 1,
    marginTop: -PANEL_OVERLAP,
    backgroundColor: colors.bg,
    borderTopLeftRadius: PANEL_OVERLAP,
    borderTopRightRadius: PANEL_OVERLAP,
    overflow: 'hidden',
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginLeft: -4,
    marginBottom: spacing.xs,
  },
  backLabel: {
    ...typography.label,
    fontSize: 15,
    color: colors.textInverse,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
