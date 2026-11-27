// White pill around a ride's wait ("25 min wait" / "Walk On" / "No posted
// wait") — rec cards, rec tiles and Discover rows. Sits next to the verdict
// badge at the same height; the walk time beside it is plain text.
// Status text (Down / Closed / Refurbishment) stays unpilled.

import React from 'react';
import { LayoutChangeEvent, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, shadows } from '../theme/tokens';

/** Shared with VerdictBadge so the two pills sit at the same height. */
export const PILL_HEIGHT = 28;

interface WaitPillProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  onLayout?: (e: LayoutChangeEvent) => void;
  testID?: string;
}

export function WaitPill({ children, style, onLayout, testID }: WaitPillProps): React.ReactElement {
  return (
    <View style={[styles.pill, style]} onLayout={onLayout} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    // Fixed height, centered by the row (no alignSelf) — lines up with the
    // verdict badge whatever the content, including the icon-only Walk On.
    height: PILL_HEIGHT,
    minWidth: PILL_HEIGHT,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    ...shadows.card,
  },
});
