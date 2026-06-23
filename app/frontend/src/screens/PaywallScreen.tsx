// PaywallScreen — full-screen modal presenting the trip-unlock offer.
// Shown when user taps "Unlock" from a PaywallTeaser or Recommendations lock.
//
// Phase 4 (IAP) will wire the purchase button to StoreKit.
// Phase 5 will add promo code redemption.
// For now the screen is the UI shell — the CTA is stubbed.

import React, { useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import { ChevronLeft, Check } from 'lucide-react-native';
import { validatePromoCode } from '../api';
import { TripDatePicker, TripDateRange } from '../components/TripDatePicker';
import { useAuth } from '../context/AuthContext';
import { useTrip } from '../context/TripContext';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

interface PaywallScreenProps {
  onClose: () => void;
}

const BENEFITS = [
  'Full-day wait forecast for every ride',
  'AI-powered "go now" recommendations',
  'Trough alerts — know the perfect moment',
  'Gold-star ride detection',
  'Notifications on your must-do rides',
];

export function PaywallScreen({ onClose }: PaywallScreenProps): React.ReactElement {
  const { getIdToken, refetchUser } = useAuth();
  const { refetchTrip } = useTrip();

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

  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoSuccess, setPromoSuccess] = useState(false);

  const handlePurchase = () => {
    // TODO Phase 4: trigger StoreKit purchase via expo-in-app-purchases
    console.log('[PaywallScreen] purchase tapped — IAP not yet wired');
  };

  const handlePromoRedeem = async () => {
    const code = promoCode.trim();
    if (!code) return;
    setPromoLoading(true);
    setPromoError(null);
    setPromoSuccess(false);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Not signed in');
      await validatePromoCode(token, { code, ...rangeRef.current });
      setPromoSuccess(true);
      await Promise.all([refetchUser(), refetchTrip()]);
      onClose();
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : 'Invalid or expired code.');
    } finally {
      setPromoLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={12}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>Club 32 Access</Text>
        <Text style={styles.headline}>Unlock your trip</Text>
        <Text style={styles.sub}>
          One-time activation for your upcoming visit. Covers up to 10 days of park time.
        </Text>

        <View style={styles.benefitsList}>
          {BENEFITS.map(b => (
            <View key={b} style={styles.benefitRow}>
              <Check size={16} color={colors.go} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        <View style={styles.pickerCard}>
          <TripDatePicker onChange={range => { rangeRef.current = range; }} />
        </View>

        <View style={styles.priceCard}>
          <Text style={styles.price}>$10</Text>
          <Text style={styles.priceSub}>per trip · one-time</Text>
        </View>

        <TouchableOpacity
          style={styles.purchaseBtn}
          onPress={handlePurchase}
          activeOpacity={0.85}
        >
          <Text style={styles.purchaseBtnText}>$10 · Activate trip access</Text>
        </TouchableOpacity>

        {/* Promo code entry */}
        <View style={styles.promoSection}>
          <Text style={styles.promoLabel}>Have a promo code?</Text>
          <View style={styles.promoRow}>
            <TextInput
              style={styles.promoInput}
              value={promoCode}
              onChangeText={setPromoCode}
              placeholder="Enter code"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
              returnKeyType="done"
              onSubmitEditing={() => void handlePromoRedeem()}
            />
            <TouchableOpacity
              style={[styles.promoBtn, promoLoading && styles.promoBtnDisabled]}
              onPress={() => void handlePromoRedeem()}
              disabled={promoLoading}
            >
              <Text style={styles.promoBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>
          {promoError ? <Text style={styles.promoError}>{promoError}</Text> : null}
          {promoSuccess ? <Text style={styles.promoSuccess}>Code applied! Unlocking your trip…</Text> : null}
        </View>

        <Text style={styles.legal}>
          Payment processed securely via Apple. No subscription — each trip is a separate purchase.
          {Platform.OS === 'ios' ? ' Purchases managed in Settings → Apple ID → Subscriptions.' : ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  eyebrow: {
    ...typography.badge,
    color: colors.brand,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.sm,
  },
  headline: {
    ...typography.screenTitle,
    color: colors.textPrimary,
  },
  sub: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  benefitsList: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  benefitText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  priceCard: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  price: {
    fontFamily: 'Lora_700Bold',
    fontSize: 48,
    color: colors.textPrimary,
    letterSpacing: -1.5,
  },
  priceSub: {
    ...typography.label,
    color: colors.textSecondary,
  },
  purchaseBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    ...shadows.card,
  },
  purchaseBtnText: {
    ...typography.label,
    fontSize: 16,
    color: colors.textInverse,
    fontWeight: '700',
  },
  promoSection: {
    gap: spacing.sm,
  },
  promoLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  promoRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  promoInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.base,
    paddingVertical: 10,
    ...typography.body,
    color: colors.textPrimary,
  },
  promoBtn: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoBtnDisabled: { opacity: 0.5 },
  promoBtnText: {
    ...typography.label,
    color: colors.textInverse,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  promoError: {
    ...typography.caption,
    color: colors.skip,
  },
  promoSuccess: {
    ...typography.caption,
    color: colors.go,
  },
  legal: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 16,
  },
});
