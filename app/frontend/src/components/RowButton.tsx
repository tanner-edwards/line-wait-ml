// Full-width row button used across onboarding screens. Tap target is the
// entire row. Title + optional subtitle stack vertically; selected state
// flips the colors and shows a checkmark.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, LucideIcon } from 'lucide-react-native';
import { colors } from '../theme/tokens';

interface Props {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

export function RowButton({ title, subtitle, icon: Icon, selected, onPress, testID }: Props): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.rowPressed,
      ]}
      testID={testID}
    >
      {Icon ? (
        <View style={styles.iconArea}>
          <Icon size={20} color={selected ? colors.brand : colors.textSecondary} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text style={[styles.title, selected && styles.titleSelected]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, selected && styles.subtitleSelected]}>{subtitle}</Text>
        ) : null}
      </View>
      <View style={styles.checkArea}>
        {selected ? <Check size={20} color={colors.brand} strokeWidth={2.5} /> : null}
      </View>
    </Pressable>
  );
}

// Exported so list screens can reserve exactly one row's footprint before
// the first item exists (MustDoRides "Your picks" placeholder).
export const ROW_BUTTON_MIN_HEIGHT = 56;
export const ROW_BUTTON_GAP = 10;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: ROW_BUTTON_GAP,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: ROW_BUTTON_MIN_HEIGHT,
  },
  rowSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.goBg,
  },
  rowPressed: {
    opacity: 0.7,
  },
  iconArea: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleSelected: {
    color: colors.brand,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: 4,
    lineHeight: 18,
  },
  subtitleSelected: {
    color: colors.brand,
  },
  checkArea: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
