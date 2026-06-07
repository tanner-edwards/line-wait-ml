// Tappable row with a native Switch on the right instead of a chevron.
// Same label-above / value-below layout as TapEditRow. Used for boolean settings.

import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';

interface ToggleRowProps {
  label: string;
  value?: string;
  enabled: boolean;
  onValueChange: (val: boolean) => void;
  disabled?: boolean;
  /** Optional color override for the value text (e.g. brand when on, skip for errors). */
  valueColor?: string;
  testID?: string;
}

export function ToggleRow({
  label,
  value,
  enabled,
  onValueChange,
  disabled,
  valueColor,
  testID,
}: ToggleRowProps): React.ReactElement {
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {value ? (
          <Text style={[styles.value, valueColor ? { color: valueColor } : undefined]}>
            {value}
          </Text>
        ) : null}
      </View>
      <Switch
        value={enabled}
        onValueChange={onValueChange}
        disabled={disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: { flex: 1, marginRight: spacing.base },
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
});
