import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'club32:debugMode';

export async function getDebugMode(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

export async function setDebugMode(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, on ? 'true' : 'false');
  } catch {
    // Non-fatal.
  }
}
