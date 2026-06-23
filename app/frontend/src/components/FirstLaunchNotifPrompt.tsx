// One-time soft prompt explaining why Club 32 wants notifications.
// Fires after onboarding completes (persona is set) on the user's first
// launch. Dismissed permanently via AsyncStorage — never shown again.
//
// Showing a custom screen BEFORE the OS dialog is Apple best practice:
// if the user denies the OS dialog, iOS never shows it again. A soft
// prompt lets us make the case first so the "deny" rate drops.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { usePersona } from '../context/PersonaContext';
import { useDevice } from '../context/DeviceContext';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

const STORAGE_KEY = 'club32:notifFirstPromptShownV1';

export function FirstLaunchNotifPrompt(): React.ReactElement {
  const { persona } = usePersona();
  const { notificationsEnabled, enableNotifications } = useDevice();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only fire once onboarding is done and notifications aren't already on.
    if (!persona || notificationsEnabled) return;
    void AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (!val) setVisible(true);
    });
  }, [persona, notificationsEnabled]);

  const dismiss = () => {
    setVisible(false);
    void AsyncStorage.setItem(STORAGE_KEY, '1');
  };

  const handleEnable = () => {
    dismiss();
    void enableNotifications();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Bell size={32} color={colors.brand} />
          </View>

          <Text style={styles.title}>Stay ahead of the crowds</Text>

          <Text style={styles.body}>
            Club 32 can alert you the moment your must-do rides hit a short wait — before the crowd catches on.
          </Text>

          <Pressable
            onPress={handleEnable}
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
          >
            <Text style={styles.btnPrimaryText}>Turn on notifications</Text>
          </Pressable>

          <Pressable
            onPress={dismiss}
            style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
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
