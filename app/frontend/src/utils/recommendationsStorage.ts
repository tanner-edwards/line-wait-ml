// AsyncStorage wrapper for the Recommendations screen's persisted selection.
//
// Persistence rule (per the v2 spec):
//   - No persisted selection → open the picker.
//   - Persisted selection < 1 hour old → skip the picker, fetch immediately.
//   - Persisted selection >= 1 hour old → open the picker pre-filled.
//
// The persistence is *until-replaced* (no midnight reset, no eviction). The
// staleness check only governs whether to re-prompt; the saved values stay
// for the picker's pre-fill regardless.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ParkSlug } from '../types';

const STORAGE_KEY = 'club32:recommendations:lastSelection';
export const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export interface PersistedSelection {
  park: ParkSlug;
  currentRideId: string;
  /** Unix ms when this selection was last set. */
  timestamp: number;
}

/** Returns the persisted selection, or `null` if none exists / is corrupt. */
export async function getLastSelection(): Promise<PersistedSelection | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedSelection(parsed)) return null;
    return parsed;
  } catch {
    // Storage failure shouldn't crash the app — just behave like first run.
    return null;
  }
}

/** Persists the current selection, stamping it with Date.now(). */
export async function setLastSelection(
  park: ParkSlug,
  currentRideId: string
): Promise<void> {
  const payload: PersistedSelection = {
    park,
    currentRideId,
    timestamp: Date.now(),
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage failure is non-fatal — selection is still in-memory for the
    // current session, we just won't remember it next launch.
  }
}

/** True when the saved selection is at or beyond the staleness threshold —
 *  the picker should re-open pre-filled when this is true. */
export function isStale(
  selection: PersistedSelection | null,
  now: number = Date.now()
): boolean {
  if (!selection) return true;
  return now - selection.timestamp >= STALE_THRESHOLD_MS;
}

function isPersistedSelection(x: unknown): x is PersistedSelection {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    (o.park === 'disneyland' || o.park === 'california-adventure') &&
    typeof o.currentRideId === 'string' &&
    o.currentRideId.length > 0 &&
    typeof o.timestamp === 'number' &&
    Number.isFinite(o.timestamp)
  );
}

// Test helper — clears the storage key so each test starts clean.
export async function _resetForTests(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
