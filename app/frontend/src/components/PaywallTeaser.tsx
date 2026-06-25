// PaywallTeaser — shown inside the ride detail modal when no active trip.
// Replaces the TodaysRange + TrendGraph + FullDayForecast tiles with a
// single card prompting the user to activate trip access.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

interface PaywallTeaserProps {
  onUnlock: () => void;
}

export function PaywallTeaser({ onUnlock }: PaywallTeaserProps): React.ReactElement {
  return (
    <View style={styles.card}>
      <View style={styles.lockRow}>
        <Lock size={15} color={colors.brand} />
        <Text style={styles.lockLabel}>Trip access required</Text>
      </View>

      <Text style={styles.teaser}>
        Activate a trip to see full-day wait forecasts, timed recommendations, and ride alerts.
      </Text>

      <Pressable
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        onPress={onUnlock}
      >
        <Text style={styles.btnText}>Unlock these features →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...shadows.card,
  },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  lockLabel: {
    ...typography.badge,
    color: colors.brand,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  teaser: {
    ...typography.body,
    color: colors.textPrimary,
  },
  btn: {
    backgroundColor: colors.brand,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnPressed: { opacity: 0.82 },
  btnText: {
    ...typography.label,
    fontSize: 14,
    color: colors.textInverse,
    fontWeight: '600',
  },
});
