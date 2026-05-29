// AsyncStorage wrapper for the v3 user persona.
//
// Persistence rule: write-once, kept forever until explicitly cleared. The
// debug "reset persona" action in Profile is the only thing that clears it
// (gated behind __DEV__). Each field independently validates so a partially
// corrupted blob still surfaces the salvageable fields.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AccessibilityNeed,
  Persona,
  RideCategory,
  TripDuration,
} from '../types';

const STORAGE_KEY = 'club32:persona';

const TRIP_DURATIONS: readonly TripDuration[] = ['1-day', '2-days', '3-4-days', '5-plus-days'];
const RIDE_CATEGORIES: readonly RideCategory[] = [
  'thrills', 'classics', 'immersive', 'kid-favorites', 'shows-characters', 'first-time',
];
const ACCESSIBILITY_NEEDS: readonly AccessibilityNeed[] = [
  'stroller', 'wheelchair', 'pregnant', 'sensory', 'none',
];

export async function getPersona(): Promise<Persona | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed);
  } catch {
    return null;
  }
}

export async function setPersona(persona: Persona): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persona));
  } catch {
    // Non-fatal — persona stays in-memory for the session.
  }
}

export async function clearPersona(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

function validate(x: unknown): Persona | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;

  const tripDuration =
    typeof o.tripDuration === 'string' && (TRIP_DURATIONS as readonly string[]).includes(o.tripDuration)
      ? (o.tripDuration as TripDuration)
      : null;

  let youngestAge: number | null = null;
  if (typeof o.youngestAge === 'number' && Number.isFinite(o.youngestAge)) {
    youngestAge = Math.max(0, Math.min(18, Math.round(o.youngestAge)));
  }

  const ridePreferences: RideCategory[] = Array.isArray(o.ridePreferences)
    ? o.ridePreferences.filter(
        (v): v is RideCategory =>
          typeof v === 'string' && (RIDE_CATEGORIES as readonly string[]).includes(v)
      )
    : [];

  const mustDoRideIds: string[] = Array.isArray(o.mustDoRideIds)
    ? o.mustDoRideIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];

  const accessibilityNeeds: AccessibilityNeed[] = Array.isArray(o.accessibilityNeeds)
    ? o.accessibilityNeeds.filter(
        (v): v is AccessibilityNeed =>
          typeof v === 'string' && (ACCESSIBILITY_NEEDS as readonly string[]).includes(v)
      )
    : [];

  return { tripDuration, youngestAge, ridePreferences, mustDoRideIds, accessibilityNeeds };
}

// Test helper.
export async function _resetForTests(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
