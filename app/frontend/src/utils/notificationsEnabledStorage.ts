import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'club32:notificationsEnabled';

export async function getNotificationsEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Non-fatal — state stays in-memory for the session.
  }
}
