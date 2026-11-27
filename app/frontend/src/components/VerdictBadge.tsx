// Solid call-to-action badge for rec cards and Discover rows. Takes a stance
// in plain words — the verdict as an instruction, not a label:
//
//   star → ★ RARE FIND   (gold)   wait this low doesn't happen often
//   go   → ✓ RIDE IT     (green)
//   skip → ⊗ DON'T GO    (red)
//
// Neutral renders nothing — the row stays quiet. Tiles keep the old
// icon-only Pill.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CircleCheck, OctagonX, Gem } from 'lucide-react-native';
import { colors, fonts, radius } from '../theme/tokens';
import { PILL_HEIGHT } from './WaitPill';

export type VerdictBadgeVariant = 'star' | 'go' | 'skip';

const BADGE: Record<VerdictBadgeVariant, { label: string; bg: string }> = {
  star: { label: 'RARE FIND', bg: colors.star },
  go: { label: 'RIDE IT', bg: colors.go },
  skip: { label: "DON'T GO", bg: colors.skip },
};

const ICON_SIZE = 15;
const FG = '#FFFFFF';

export function VerdictBadge({ variant }: { variant: VerdictBadgeVariant }): React.ReactElement {
  const { label, bg } = BADGE[variant];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]} testID={`badge-${variant}`}>
      {variant === 'star' ? (
        <Gem size={ICON_SIZE} color={FG} />
      ) : variant === 'go' ? (
        <CircleCheck size={ICON_SIZE} color={FG} strokeWidth={2.5} />
      ) : (
        <OctagonX size={ICON_SIZE} color={FG} strokeWidth={2.5} />
      )}
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    height: PILL_HEIGHT,
    borderRadius: radius.pill,
  },
  label: {
    fontFamily: fonts.uiBold,
    fontSize: 14,
    letterSpacing: 0.4,
    color: FG,
  },
});
