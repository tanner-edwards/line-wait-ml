// Loads + looks up historical_averages docs that the cron writes to Firestore.
// Module-scope cache: load once per Lambda cold start, hold forever (averages
// change at most weekly — no in-handler TTL refresh needed).

import { getFirestore } from './firestoreClient';
import { DayType, HistoricalBucket, ParkSlug, PARKS } from './types';

interface LookupValue {
  mean: number;
  sampleCount: number;
}

// Lazy-init pattern: the first call that needs averages awaits the load.
// Subsequent calls reuse the same map.
let loadPromise: Promise<Map<string, LookupValue>> | null = null;

function key(parkId: string, rideId: string, bucket: string, dayType: DayType): string {
  return `${parkId}__${rideId}__${bucket}__${dayType}`;
}

async function loadAll(): Promise<Map<string, LookupValue>> {
  const db = getFirestore();
  const snap = await db.collection('historical_averages').get();
  const map = new Map<string, LookupValue>();
  snap.forEach(doc => {
    const d = doc.data() as {
      parkId: string;
      rideId: string;
      bucket: string;
      dayType: DayType;
      mean: number;
      sampleCount: number;
    };
    map.set(key(d.parkId, d.rideId, d.bucket, d.dayType), {
      mean: d.mean,
      sampleCount: d.sampleCount,
    });
  });
  return map;
}

export function ensureLoaded(): Promise<Map<string, LookupValue>> {
  if (!loadPromise) loadPromise = loadAll();
  return loadPromise;
}

/**
 * Look up the historical average for a single ride at a single bucket.
 * Returns null when no doc exists (new ride, missing data, park-closed-
 * during-this-hour-historically).
 */
export function lookupAverage(
  averagesMap: Map<string, LookupValue>,
  parkSlug: ParkSlug,
  rideId: string,
  bucket: string,
  dayType: DayType
): LookupValue | null {
  const parkId = PARKS[parkSlug].id;
  return averagesMap.get(key(parkId, rideId, bucket, dayType)) ?? null;
}

/**
 * Builds a HistoricalBucket entry — either with real data or with the spec'd
 * "missing" shape (wait: null, sampleCount: 0).
 */
export function bucketEntry(
  offsetMinutes: 0 | 30 | 60 | 90 | 120 | 150,
  timeSlot: string,
  value: LookupValue | null
): HistoricalBucket {
  return {
    offsetMinutes,
    timeSlot,
    wait: value?.mean ?? null,
    sampleCount: value?.sampleCount ?? 0,
  };
}

// Test helper: clear the module-level lazy-load.
export function _resetForTests(): void {
  loadPromise = null;
}
