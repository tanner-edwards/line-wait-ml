// Blocking modal that prompts the user to enable or disable notifications
// based on whether their GPS location is near Disneyland Resort.
//
// Two cases:
//   • At the park, notifications off → "Looks like you're at the park. Turn on?"
//   • Away from park, notifications on → "You're not at the park. Turn off?"
//
// Shown at most once per calendar day (persisted in AsyncStorage). Never shown
// if GPS is unavailable. Blocks interaction — user must answer Yes or No.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { useLocation } from '../context/LocationContext';
import { useDevice } from '../context/DeviceContext';
import { haversineMeters } from '../grouping';
import { colors } from '../theme/tokens';

const STORAGE_KEY = 'club32:locationPromptDate';

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function hasPromptedToday(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === todayString();
  } catch {
    return false;
  }
}

async function markPromptedToday(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, todayString());
  } catch {
    // Non-fatal.
  }
}

// Center of Disneyland Resort (midpoint between the two parks + esplanade).
const DLR_LAT = 33.8100;
const DLR_LNG = -117.9210;
// ~1km — confidently on-property. Captures both parks, esplanade, Downtown Disney.
const DLR_RADIUS_M = 1000;

function isAtDisneyland(lat: number, lng: number): boolean {
  return haversineMeters(lat, lng, DLR_LAT, DLR_LNG) <= DLR_RADIUS_M;
}

type PromptKind = 'enable' | 'disable';

export function LocationNotificationPrompt(): React.ReactElement {
  const { coords } = useLocation();
  const { notificationsEnabled, enableNotifications, disableNotifications } = useDevice();
  const [dismissed, setDismissed] = useState(true); // default true until storage check clears it
  const [kind, setKind] = useState<PromptKind | null>(null);

  // Check AsyncStorage on mount — skip if already prompted today.
  useEffect(() => {
    void hasPromptedToday().then(already => {
      if (!already) setDismissed(false);
    });
  }, []);

  useEffect(() => {
    if (dismissed || !coords) return;
    const atPark = isAtDisneyland(coords.lat, coords.lng);
    if (atPark && !notificationsEnabled) {
      setKind('enable');
    } else if (!atPark && notificationsEnabled) {
      setKind('disable');
    } else {
      setKind(null);
    }
  }, [coords, notificationsEnabled, dismissed]);

  const dismiss = () => {
    void markPromptedToday();
    setDismissed(true);
  };

  const onYes = async () => {
    dismiss();
    if (kind === 'enable') await enableNotifications();
    else await disableNotifications();
  };

  const visible = !dismissed && kind !== null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <MapPin size={18} color={kind === 'enable' ? colors.brand : colors.textTertiary} />
            <Text style={styles.title}>
              {kind === 'enable' ? ' You\'re at the park!' : ' You\'re not at the park'}
            </Text>
          </View>
          <Text style={styles.message}>
            {kind === 'enable'
              ? 'Want to turn on ride notifications? We\'ll let you know when your must-do rides hit a short wait or go down.'
              : 'You have ride notifications turned on. Want to turn them off while you\'re away?'}
          </Text>
          {kind === 'enable' ? (
            <Text style={styles.hint}>You can always manage this in Profile → Notifications.</Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              onPress={onYes}
              style={({ pressed }) => [styles.btn, styles.btnYes, pressed && styles.pressed]}
              testID="location-prompt-yes"
            >
              <Text style={styles.btnYesText}>Yes</Text>
            </Pressable>
            <Pressable
              onPress={dismiss}
              style={({ pressed }) => [styles.btn, styles.btnNo, pressed && styles.pressed]}
              testID="location-prompt-no"
            >
              <Text style={styles.btnNoText}>Not now</Text>
            </Pressable>
          </View>
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
    padding: 32,
  },
  card: {
    backgroundColor: '#fff', // TODO: tokenize
    borderRadius: 16,
    padding: 24,
    width: '100%',
    shadowColor: '#000', // TODO: tokenize
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#222' }, // TODO: tokenize
  message: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 10 }, // TODO: tokenize
  hint: { fontSize: 12, color: colors.textTertiary, marginBottom: 20 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnYes: { backgroundColor: colors.brand },
  btnYesText: { color: '#fff', fontWeight: '700', fontSize: 16 }, // TODO: tokenize
  btnNo: { backgroundColor: '#f0f0f0' }, // TODO: tokenize
  btnNoText: { color: '#555', fontWeight: '600', fontSize: 16 }, // TODO: tokenize
  pressed: { opacity: 0.7 },
});
