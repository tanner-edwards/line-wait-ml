import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'club32:retiredRides:v1';

export interface RetiredRidesState {
  // The trip this list belongs to. Null means "no trip seen yet" — the
  // list is still valid until a real trip id shows up.
  tripId: string | null;
  rideIds: string[];
}

const EMPTY: RetiredRidesState = { tripId: null, rideIds: [] };

export async function getRetiredRides(): Promise<RetiredRidesState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<RetiredRidesState>;
    return {
      tripId: typeof parsed.tripId === 'string' ? parsed.tripId : null,
      rideIds: Array.isArray(parsed.rideIds)
        ? parsed.rideIds.filter((x): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    return EMPTY;
  }
}

export async function setRetiredRides(state: RetiredRidesState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Non-fatal — state stays in-memory for the session.
  }
}
