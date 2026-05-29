// AsyncStorage wrapper for the per-day "Which parks today?" answer.
//
// Persistence rule: written when the user answers the daily prompt; the saved
// `date` field is compared against today's local YYYY-MM-DD on app open. When
// the saved date is older than today, the answer is considered stale and the
// daily prompt is shown again. Mid-day toggles also write through so the
// answer persists for the rest of the day.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DailyContext, DailyParks } from '../types';

const STORAGE_KEY = 'club32:dailyContext';

const VALID_PARKS: readonly DailyParks[] = ['disneyland', 'california-adventure', 'both'];

export async function getDailyContext(): Promise<DailyContext | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed);
  } catch {
    return null;
  }
}

export async function setDailyContext(parks: DailyParks): Promise<DailyContext> {
  const payload: DailyContext = { date: todayLocalDate(), parks };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Non-fatal.
  }
  return payload;
}

export async function clearDailyContext(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

/** YYYY-MM-DD in the user's local timezone. */
export function todayLocalDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isStale(
  context: DailyContext | null,
  now: Date = new Date()
): boolean {
  if (!context) return true;
  return context.date !== todayLocalDate(now);
}

function validate(x: unknown): DailyContext | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.date !== 'string' || o.date.length === 0) return null;
  if (typeof o.parks !== 'string' || !(VALID_PARKS as readonly string[]).includes(o.parks)) return null;
  return { date: o.date, parks: o.parks as DailyParks };
}

// Test helper.
export async function _resetForTests(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
