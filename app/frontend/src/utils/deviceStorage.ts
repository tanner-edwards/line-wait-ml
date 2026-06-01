// AsyncStorage wrapper for an anonymous per-device identifier. Generated
// once on first read and persisted forever. Used as the primary key in the
// backend `devices` collection — it ties this device's notification prefs
// to the must-do list, arm state, and push token.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'club32:deviceId';

export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(STORAGE_KEY);
    if (existing && isValidUuid(existing)) return existing;
  } catch {
    // Non-fatal — fall through and generate a fresh one.
  }
  const next = generateUuid();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Non-fatal — caller will still get a UUID for this session.
  }
  return next;
}

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function generateUuid(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoRef?.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  // Math.random fallback — not cryptographically secure, but fine for an
  // anonymous device identifier with no security implications.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Test helper.
export async function _resetForTests(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
