// Full-width row button used across onboarding screens. Tap target is the
// entire row. Title + optional subtitle stack vertically; selected state
// flips the colors and shows a checkmark.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { colors } from '../theme/tokens';

interface Props {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

export function RowButton({ title, subtitle, selected, onPress, testID }: Props): React.ReactElement {
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

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 56,
  },
  rowSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.goBg,
  },
  rowPressed: {
    opacity: 0.7,
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
