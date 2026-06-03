// AsyncStorage cache for the notification history sheet.
// Keyed per device so the cached list is always device-specific.
// Swallows errors in both directions — a stale or missing cache is fine.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { NotificationLogEntry } from '../types';

function key(deviceId: string): string {
  return `club32:notificationHistory:${deviceId}`;
}

export async function getCachedNotifications(deviceId: string): Promise<NotificationLogEntry[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key(deviceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NotificationLogEntry[]) : null;
  } catch {
    return null;
  }
}

export async function setCachedNotifications(deviceId: string, entries: NotificationLogEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key(deviceId), JSON.stringify(entries));
  } catch {
    // Non-fatal.
  }
}
