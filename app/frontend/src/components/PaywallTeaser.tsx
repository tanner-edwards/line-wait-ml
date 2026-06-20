// PaywallTeaser — shown inside the ride detail modal when no active trip.
// Replaces the TodaysRange + TrendGraph + FullDayForecast tiles with a
// single card that surfaces one tantalizing data point and a CTA to unlock.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { FullDaySlot } from '../types';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

interface PaywallTeaserProps {
  rideName: string;
  fullDayForecast?: FullDaySlot[] | null;
  onUnlock: () => void;
}

function buildTeaserText(
  rideName: string,
  forecast: FullDaySlot[] | null | undefined
): string {
  if (!forecast) {
    return `See when ${rideName} waits will be shortest today.`;
  }
  const operating = forecast.filter(s => s.wait !== null && s.wait > 0);
  if (operating.length === 0) {
    return `See predicted wait times for ${rideName} throughout the day.`;
  }
  const min = operating.reduce((a, b) => (b.wait! < a.wait! ? b : a));
  return `${rideName} drops to ~${min.wait} min around ${formatSlot(min.timeSlot)} today.`;
}

function formatSlot(slot: string): string {
  const [start] = slot.split('-');
  if (!start) return slot;
  const [h, m] = start.split(':').map(Number);
  if (h === undefined || m === undefined) return slot;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${period}` : `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}

export function PaywallTeaser({ rideName, fullDayForecast, onUnlock }: PaywallTeaserProps): React.ReactElement {
  const teaser = buildTeaserText(rideName, fullDayForecast);

  return (
    <View style={styles.card}>
      <View style={styles.lockRow}>
        <Lock size={15} color={colors.brand} />
        <Text style={styles.lockLabel}>Trip access required</Text>
      </View>

      <Text style={styles.teaser}>{teaser}</Text>

      <Pressable
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        onPress={onUnlock}
      >
        <Text style={styles.btnText}>Unlock to see when →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.base,
    marginTop: spacing.sm,
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
