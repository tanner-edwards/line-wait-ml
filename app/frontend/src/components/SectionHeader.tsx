// Uppercase section label with optional right-aligned action link.
// Used inside sheets, cards, and screen sections.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme/tokens';

interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
  testID?: string;
}

export function SectionHeader({ title, action, testID }: SectionHeaderProps): React.ReactElement {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text style={styles.action}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  title: {
    ...typography.badge,
    color: colors.textTertiary,
  },
  action: {
    ...typography.caption,
    color: colors.brand,
    fontWeight: '600',
  },
});
