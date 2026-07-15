// PaywallScreen — full-screen modal presenting the trip-unlock offer.
// Phase 4: StoreKit consumable purchase via expo-iap.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
  getTransactionJwsIOS,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
} from 'expo-iap';
import { checkPromoCode, purchaseTrip, validatePromoCode } from '../api';
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

  const scrollRef = useRef<ScrollView>(null);
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
  const [validatedPromo, setValidatedPromo] = useState<string | null>(null);

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
        // StoreKit 2 — get the signed JWS for this transaction.
        const jws = await getTransactionJwsIOS(purchase.productId);
        if (!jws) throw new Error('Could not get transaction data');
        await handlePurchaseSuccess(jws);
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

  const handleActivate = async () => {
    if (validatedPromo) {
      // Promo path: claim the validated code.
      setPurchasing(true);
      setPurchaseError(null);
      try {
        const token = await getIdToken();
        if (!token) throw new Error('Not signed in');
        await validatePromoCode(token, { code: validatedPromo, ...rangeRef.current });
        await Promise.all([refetchUser(), refetchTrip()]);
        onClose();
      } catch (err) {
        Alert.alert('Could not apply code', err instanceof Error ? err.message : 'Please try again.');
        setPurchasing(false);
      }
      return;
    }

    // IAP path.
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

  const handlePromoApply = async () => {
    const code = promoCode.trim();
    if (!code) return;
    setPromoLoading(true);
    setPromoError(null);
    setValidatedPromo(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Not signed in');
      await checkPromoCode(token, code);
      setValidatedPromo(code);
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : 'Invalid or expired code.');
    } finally {
      setPromoLoading(false);
    }
  };

  const priceLabel = localizedPrice ?? '$10';

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={12}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
          <Text style={[styles.price, validatedPromo ? styles.priceFree : null]}>
            {validatedPromo ? 'Free' : priceLabel}
          </Text>
          <Text style={styles.priceSub}>per trip · one-time</Text>
        </View>

        <TouchableOpacity
          style={[styles.purchaseBtn, purchasing && styles.purchaseBtnDisabled]}
          onPress={() => void handleActivate()}
          disabled={purchasing}
          activeOpacity={0.85}
        >
          {purchasing
            ? <ActivityIndicator color={colors.textInverse} />
            : <Text style={styles.purchaseBtnText}>
                {validatedPromo ? 'Activate free trip' : 'Activate trip access'}
              </Text>}
        </TouchableOpacity>

        {purchaseError ? <Text style={styles.purchaseError}>{purchaseError}</Text> : null}

        <View style={styles.promoSection}>
          <Text style={styles.promoLabel}>Have a promo code?</Text>
          {validatedPromo ? (
            <View style={styles.promoApplied}>
              <Check size={14} color={colors.go} />
              <Text style={styles.promoAppliedText}>Code applied — trip is free</Text>
              <TouchableOpacity onPress={() => { setValidatedPromo(null); setPromoCode(''); }}>
                <Text style={styles.promoRemove}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.promoRow}>
              <TextInput
                style={styles.promoInput}
                value={promoCode}
                onChangeText={text => { setPromoCode(text); setPromoError(null); }}
                placeholder="Enter code"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="characters"
                returnKeyType="done"
                onSubmitEditing={() => void handlePromoApply()}
                onFocus={() => {
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
                }}
              />
              <TouchableOpacity
                style={[styles.promoBtn, promoLoading && styles.promoBtnDisabled]}
                onPress={() => void handlePromoApply()}
                disabled={promoLoading}
              >
                {promoLoading
                  ? <ActivityIndicator size="small" color={colors.textInverse} />
                  : <Text style={styles.promoBtnText}>Apply</Text>}
              </TouchableOpacity>
            </View>
          )}
          {promoError ? <Text style={styles.promoError}>{promoError}</Text> : null}
        </View>

        <Text style={styles.legal}>
          Payment processed securely via Apple. No subscription — each trip is a separate purchase.
          {Platform.OS === 'ios' ? ' Purchases managed in Settings → Apple ID → Subscriptions.' : ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
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
  priceFree: {
    color: colors.go,
  },
  promoApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.go,
    paddingHorizontal: spacing.base,
    paddingVertical: 10,
  },
  promoAppliedText: {
    ...typography.body,
    color: colors.go,
    flex: 1,
  },
  promoRemove: {
    ...typography.caption,
    color: colors.textTertiary,
    textDecorationLine: 'underline',
  },
  legal: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 16,
  },
});
