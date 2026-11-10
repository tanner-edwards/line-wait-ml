// Filter chips above the Discover list: Nearby / By Land / Your List.
// Chips and the header sort menu are mutually exclusive — Home.tsx owns that
// state; this is presentation only.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Bookmark, Castle, MapPin } from 'lucide-react-native';
import { colors, fonts, spacing } from '../theme/tokens';

export type DiscoverChip = 'nearby' | 'land' | 'list';

interface Props {
  active: DiscoverChip | null;
  /** Shown in place of "By Land" once a land is picked. */
  landLabel: string | null;
  onNearby: () => void;
  onLand: () => void;
  onList: () => void;
}

export function DiscoverChips({ active, landLabel, onNearby, onLand, onList }: Props): React.ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      <Chip icon={MapPin} label="Nearby" active={active === 'nearby'} onPress={onNearby} testID="chip-nearby" />
      <Chip
        icon={Castle}
        label={active === 'land' && landLabel ? landLabel : 'By Land'}
        active={active === 'land'}
        onPress={onLand}
        testID="chip-land"
      />
      <Chip icon={Bookmark} label="Your List" active={active === 'list'} onPress={onList} testID="chip-list" />
    </ScrollView>
  );
}

function Chip({
  icon: Icon,
  label,
  active,
  onPress,
  testID,
}: {
  icon: typeof MapPin;
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  const fg = active ? colors.textInverse : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.chipPressed]}
      testID={testID}
    >
      <Icon size={16} color={fg} />
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // ScrollView defaults to flexShrink: 1 — without 0 here a long list below
  // squeezes this row's height and clips the chip labels.
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipPressed: { opacity: 0.8 },
  label: { fontFamily: fonts.uiSemiBold, fontSize: 14, fontWeight: '600' },
});
