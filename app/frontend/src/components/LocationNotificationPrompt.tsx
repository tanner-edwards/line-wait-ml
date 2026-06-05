// Banner that prompts the user to enable or disable notifications based on
// whether their GPS location is near Disneyland Resort.
//
// Two cases:
//   • At the park, notifications off → "Looks like you're at the park. Turn on?"
//   • Away from park, notifications on → "You're not at the park. Turn off?"
//
// Shown at most once per calendar day (persisted in AsyncStorage). Never shown
// if GPS is unavailable.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocation } from '../context/LocationContext';
import { useDevice } from '../context/DeviceContext';
import { haversineMeters } from '../grouping';

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

export function LocationNotificationPrompt(): React.ReactElement | null {
  const { coords } = useLocation();
  const { notificationsEnabled, enableNotifications, disableNotifications } = useDevice();
  const [dismissed, setDismissed] = useState(true); // default true until storage check clears it
  const [kind, setKind] = useState<PromptKind | null>(null);

  // Check AsyncStorage on mount — hide if already prompted today.
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

  if (dismissed || !kind) return null;

  const dismiss = () => {
    void markPromptedToday();
    setDismissed(true);
  };

  const onYes = async () => {
    dismiss();
    if (kind === 'enable') await enableNotifications();
    else await disableNotifications();
  };

  return (
    <View style={styles.banner}>
      <Text style={styles.message}>
        {kind === 'enable'
          ? "Looks like you're at the park. Turn on ride notifications?"
          : "You're not at the park. Turn off ride notifications?"}
      </Text>
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
          <Text style={styles.btnNoText}>No</Text>
        </Pressable>
      </View>
      {kind === 'enable' ? (
        <Text style={styles.hint}>You can manage this in Profile → Notifications.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#f0f0ff',
    borderBottomColor: '#d0d0f0',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  message: { fontSize: 14, color: '#222', marginBottom: 10 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnYes: { backgroundColor: '#4a4ec7' },
  btnYesText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnNo: { backgroundColor: '#e5e5e5' },
  btnNoText: { color: '#444', fontWeight: '600', fontSize: 14 },
  pressed: { opacity: 0.7 },
  hint: { fontSize: 11, color: '#888', marginTop: 8 },
});
