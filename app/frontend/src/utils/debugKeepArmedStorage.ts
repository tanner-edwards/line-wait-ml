import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'club32:debugKeepArmed';

export async function getDebugKeepArmed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setDebugKeepArmed(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // Non-fatal.
  }
}
