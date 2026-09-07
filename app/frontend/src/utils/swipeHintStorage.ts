import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'club32:swipeHintShownV1';

export async function getSwipeHintShown(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === '1';
  } catch {
    return false;
  }
}

export async function setSwipeHintShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Non-fatal — worst case the peek animation replays once more.
  }
}
