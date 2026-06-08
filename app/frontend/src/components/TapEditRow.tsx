// Tappable row: label (uppercase caption) + current value + chevron.
// Replaces the hand-rolled Row pattern in Profile and similar settings screens.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';

interface TapEditRowProps {
  label: string;
  value: string;
  onPress: () => void;
  icon?: string;
  /** Clamp the value text to N lines. Useful for long lists like must-do rides. */
  numberOfLines?: number;
  testID?: string;
}

export function TapEditRow({ label, value, onPress, icon, numberOfLines, testID }: TapEditRowProps): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={testID}
    >
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} numberOfLines={numberOfLines}>{value}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.bg },
  icon: {
    fontSize: 18,
    marginRight: spacing.sm,
  },
  text: { flex: 1 },
  label: {
    fontSize: 12,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 16,
    color: colors.textPrimary,
    marginTop: 4,
  },
  chevron: {
    fontSize: 22,
    color: colors.textTertiary,
    marginLeft: 8,
  },
});
