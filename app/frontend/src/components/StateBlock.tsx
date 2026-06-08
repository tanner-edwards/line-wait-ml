// Shared icon + title + body + optional action button pattern.
// Used for all loading, error, and empty states in Home and Recommendations.
// Calm and helpful — no alarming red, generous spacing.

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme/tokens';

interface StateBlockProps {
  /** Lucide icon element at 48px. Omit when loading=true. */
  icon?: React.ReactElement;
  /** Show a brand-colored spinner instead of an icon. */
  loading?: boolean;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void; testID?: string };
  testID?: string;
}

export function StateBlock({
  icon,
  loading,
  title,
  body,
  action,
  testID,
}: StateBlockProps): React.ReactElement {
  return (
    <View style={styles.container} testID={testID}>
      {loading ? (
        <ActivityIndicator size="large" color={colors.brand} style={styles.iconSlot} />
      ) : icon ? (
        <View style={styles.iconSlot}>{icon}</View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          testID={action.testID}
        >
          <Text style={styles.buttonText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxxl,
  },
  iconSlot: {
    marginBottom: spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    width: 48,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
    marginBottom: spacing.base,
  },
  button: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.brand,
  },
  buttonPressed: { opacity: 0.75 },
  buttonText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '600',
  },
});
