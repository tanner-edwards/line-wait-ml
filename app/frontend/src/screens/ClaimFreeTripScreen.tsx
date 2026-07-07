// Shown once, right after onboarding, for users who haven't claimed their
// free trip yet. Uses the same TripDatePicker as the paid flow — the only
// difference is the CTA ("Claim free trip" vs "$10 · Activate").
//
// On success: refetchUser() flips freeTripClaimed → true, which removes this
// gate in RootNavigator, and refetchTrip() sets hasActiveTrip → true so paid
// features unlock immediately.

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gift } from 'lucide-react-native';
import { claimFreeTrip } from '../api';
import { TripDatePicker, TripDateRange } from '../components/TripDatePicker';
import { useAuth } from '../context/AuthContext';
import { useTrip } from '../context/TripContext';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

interface ClaimFreeTripScreenProps {
  onSkip: () => void;
}

export function ClaimFreeTripScreen({ onSkip }: ClaimFreeTripScreenProps): React.ReactElement {
  const { getIdToken, refetchUser } = useAuth();
  const { refetchTrip } = useTrip();

  // Default to today + 3 days so the button is always enabled on first render.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const defaultEnd = new Date(today);
  defaultEnd.setDate(today.getDate() + 2);

  const rangeRef = useRef<TripDateRange>({
    tripStart: toYMD(today),
    tripEnd: toYMD(defaultEnd),
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClaim = async () => {
    setError(null);
    setLoading(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Not signed in');
      await claimFreeTrip(token, rangeRef.current);
      await Promise.all([refetchUser(), refetchTrip()]);
      // RootNavigator re-evaluates once refetchUser resolves — no navigation needed.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Gift size={36} color={colors.brand} />
          </View>
          <Text style={styles.eyebrow}>Welcome to Club 32</Text>
          <Text style={styles.headline}>Your first trip's on us</Text>
          <Text style={styles.sub}>
            Pick your visit dates and we'll unlock full access — forecasts, recommendations, and ride alerts — for your entire trip.
          </Text>
        </View>

        <View style={styles.pickerCard}>
          <TripDatePicker onChange={range => { rangeRef.current = range; }} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.claimBtn, loading && styles.claimBtnDisabled]}
          onPress={() => void handleClaim()}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color={colors.textInverse} />
            : <Text style={styles.claimBtnText}>Claim free trip</Text>}
        </TouchableOpacity>
        <Text style={styles.legal}>One free trip per account. No payment required.</Text>
        <TouchableOpacity onPress={onSkip} hitSlop={12}>
          <Text style={styles.skipLink}>Maybe later</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  hero: { gap: spacing.base, alignItems: 'center' },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  eyebrow: {
    ...typography.badge,
    color: colors.brand,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headline: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  sub: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.xl,
    ...shadows.card,
  },
  error: {
    ...typography.caption,
    color: colors.skip,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    paddingTop: spacing.base,
    gap: spacing.sm,
    alignItems: 'center',
  },
  claimBtn: {
    width: '100%',
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    ...shadows.card,
  },
  claimBtnDisabled: { opacity: 0.6 },
  claimBtnText: {
    ...typography.label,
    fontSize: 16,
    color: colors.textInverse,
  },
  legal: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  skipLink: {
    ...typography.caption,
    color: colors.textTertiary,
    textDecorationLine: 'underline',
  },
});
