// One-time soft prompt explaining why Club 32 wants location, shown on Home
// after onboarding. The button raises the NATIVE OS dialog — it must never
// deep-link to Settings. Sending a user who had never been asked to Settings
// is what got build 1(6) rejected under App Store guideline 5.1.1(iv).
//
// Only shown while the OS is still willing to prompt ('needs-permission').
// Once permission is granted, or permanently denied, there is nothing useful
// a soft prompt can do — the Recommendations screen handles those states.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { usePersona } from '../context/PersonaContext';
import { useLocation } from '../context/LocationContext';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

const STORAGE_KEY = 'club32:locationFirstPromptShownV1';

export function FirstLaunchLocationPrompt(): React.ReactElement {
  const { persona } = usePersona();
  const { status, requestPermission } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!persona) return;
    if (status !== 'needs-permission') return;
    void AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (!val) setVisible(true);
    });
  }, [persona, status]);

  const dismiss = () => {
    setVisible(false);
    void AsyncStorage.setItem(STORAGE_KEY, '1');
  };

  const handleEnable = () => {
    dismiss();
    requestPermission();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <MapPin size={32} color={colors.brand} />
          </View>

          <Text style={styles.title}>Find rides near you</Text>

          <Text style={styles.body}>
            Club 32 uses your location to sort rides by how far you are and estimate walk times, so
            your next move is the closest good one.
          </Text>

          <Pressable
            onPress={handleEnable}
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
            testID="location-prompt-enable"
          >
            <Text style={styles.btnPrimaryText}>Enable location</Text>
          </Pressable>

          <Pressable
            onPress={dismiss}
            style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
            testID="location-prompt-dismiss"
          >
            <Text style={styles.btnSecondaryText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radius.card,
    padding: spacing.xl,
    width: '100%',
    gap: spacing.base,
    alignItems: 'center',
    ...shadows.card,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.screenTitle,
    fontSize: 22,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  btn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: {
    ...typography.label,
    fontSize: 16,
    color: colors.textInverse,
  },
  btnSecondary: { backgroundColor: colors.surface },
  btnSecondaryText: {
    ...typography.label,
    fontSize: 15,
    color: colors.textSecondary,
  },
  pressed: { opacity: 0.7 },
});
