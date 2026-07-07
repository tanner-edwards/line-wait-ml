// PaywallScreen — full-screen modal presenting the trip-unlock offer.
// Phase 4: StoreKit consumable purchase via expo-iap.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronLeft, Check } from 'lucide-react-native';
import {
  ErrorCode,
  endConnection,
  fetchProducts,
  finishTransaction,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  requestReceiptRefreshIOS,
} from 'expo-iap';
import { purchaseTrip, validatePromoCode } from '../api';
import { TripDatePicker, TripDateRange } from '../components/TripDatePicker';
import { useAuth } from '../context/AuthContext';
import { useTrip } from '../context/TripContext';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

interface PaywallScreenProps {
  onClose: () => void;
}

const PRODUCT_ID = 'com.tannere.club32.trip';

const BENEFITS = [
  'See how wait times are going to change throughout the day',
  'Know the right time to head to any ride',
  'Get alerted when a ride hits its shortest wait',
  'AI-powered recommendations',
  'Notifications on the rides you care about most',
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

  const [localizedPrice, setLocalizedPrice] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  // Store getIdToken in a ref so the purchase listener (set up on mount)
  // always calls the latest version without needing to re-register.
  const getIdTokenRef = useRef(getIdToken);
  useEffect(() => { getIdTokenRef.current = getIdToken; }, [getIdToken]);

  const handlePurchaseSuccess = useCallback(async (receiptData: string) => {
    try {
      const token = await getIdTokenRef.current();
      if (!token) throw new Error('Not signed in');
      await purchaseTrip(token, { receiptData, ...rangeRef.current });
      await Promise.all([refetchUser(), refetchTrip()]);
      onClose();
    } catch (err) {
      setPurchaseError(err instanceof Error ? err.message : 'Purchase could not be verified. Contact support.');
      setPurchasing(false);
    }
  }, [refetchUser, refetchTrip, onClose]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    let mounted = true;

    void (async () => {
      try {
        await initConnection();
        const products = await fetchProducts({ skus: [PRODUCT_ID] });
        if (mounted && products.length > 0) {
          setLocalizedPrice((products[0] as { localizedPrice?: string }).localizedPrice ?? null);
        }
      } catch {
        // Non-fatal — button still shows, falls back to '$10'
      }
    })();

    const purchaseSub = purchaseUpdatedListener(async purchase => {
      if (!mounted) return;
      try {
        // StoreKit 2 — receipt lives on-device, not on the purchase object.
        const receipt = await requestReceiptRefreshIOS();
        if (!receipt) throw new Error('Empty receipt');
        await handlePurchaseSuccess(receipt);
        await finishTransaction({ purchase, isConsumable: true });
      } catch (err) {
        if (mounted) {
          Alert.alert('Purchase error', err instanceof Error ? err.message : 'Could not verify purchase.');
          setPurchasing(false);
        }
      }
    });

    const errorSub = purchaseErrorListener(err => {
      if (!mounted) return;
      if (err.code !== ErrorCode.UserCancelled) {
        Alert.alert('Purchase failed', err.message ?? 'Please try again.');
      }
      setPurchasing(false);
    });

    return () => {
      mounted = false;
      purchaseSub.remove();
      errorSub.remove();
      void endConnection();
    };
  }, [handlePurchaseSuccess]);

  const handlePurchase = async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Not available', 'Purchases are only available on iOS.');
      return;
    }
    setPurchasing(true);
    setPurchaseError(null);
    try {
      await requestPurchase({
        request: { apple: { sku: PRODUCT_ID } },
        type: 'in-app',
      });
    } catch (err) {
      const code = (err as { code?: ErrorCode }).code;
      if (code !== ErrorCode.UserCancelled) {
        const detail = (err as { message?: string }).message ?? String(err);
        Alert.alert('Purchase failed', `${code ?? 'unknown'}: ${detail}`);
      }
      setPurchasing(false);
    }
  };

  const handlePromoRedeem = async () => {
    const code = promoCode.trim();
    if (!code) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Not signed in');
      await validatePromoCode(token, { code, ...rangeRef.current });
      await Promise.all([refetchUser(), refetchTrip()]);
      onClose();
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : 'Invalid or expired code.');
    } finally {
      setPromoLoading(false);
    }
  };

  const priceLabel = localizedPrice ?? '$10';

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
          <Text style={styles.price}>{priceLabel}</Text>
          <Text style={styles.priceSub}>per trip · one-time</Text>
        </View>

        <TouchableOpacity
          style={[styles.purchaseBtn, purchasing && styles.purchaseBtnDisabled]}
          onPress={() => void handlePurchase()}
          disabled={purchasing}
          activeOpacity={0.85}
        >
          {purchasing
            ? <ActivityIndicator color={colors.textInverse} />
            : <Text style={styles.purchaseBtnText}>Activate trip access</Text>}
        </TouchableOpacity>

        {purchaseError ? <Text style={styles.purchaseError}>{purchaseError}</Text> : null}

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
  purchaseBtnDisabled: { opacity: 0.6 },
  purchaseBtnText: {
    ...typography.label,
    fontSize: 16,
    color: colors.textInverse,
    fontWeight: '700',
  },
  purchaseError: {
    ...typography.caption,
    color: colors.skip,
    textAlign: 'center',
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
  legal: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 16,
  },
});
