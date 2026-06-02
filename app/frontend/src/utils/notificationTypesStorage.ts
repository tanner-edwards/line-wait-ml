// AsyncStorage wrapper for per-type notification opt-ins. Three booleans:
// trough / closure / reopen. Defaults to all-on; user toggles individual
// kinds off from the NotificationSettings modal.
//
// Lives alongside the device record on the backend, but cached locally
// so the modal renders without a round-trip.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { NOTIFICATION_KINDS, NotificationTypes, defaultNotificationTypes } from '../types';

const STORAGE_KEY = 'club32:notificationTypes';

export async function getNotificationTypes(): Promise<NotificationTypes> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultNotificationTypes();
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaultNotificationTypes();
    const out = defaultNotificationTypes();
    for (const kind of NOTIFICATION_KINDS) {
      if (typeof parsed[kind] === 'boolean') out[kind] = parsed[kind];
    }
    return out;
  } catch {
    return defaultNotificationTypes();
  }
}

export async function setNotificationTypes(types: NotificationTypes): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(types));
  } catch {
    // Non-fatal — state stays in-memory for the session.
  }
}

// Test helper.
export async function _resetForTests(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
