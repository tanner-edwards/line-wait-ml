// Loads + looks up ride_stats docs written by the cron.
// Module-scope cache: load once per Lambda cold start (stats change at most weekly).

import { getFirestore } from './firestoreClient';
import { DayType, ParkSlug, RideStats, PARKS } from './types';

let loadPromise: Promise<Map<string, RideStats>> | null = null;

function key(parkId: string, rideId: string, dayType: DayType): string {
  return `${parkId}__${rideId}__${dayType}`;
}

async function loadAll(): Promise<Map<string, RideStats>> {
  const db = getFirestore();
  const snap = await db.collection('ride_stats').get();
  const map = new Map<string, RideStats>();
  snap.forEach(doc => {
    const d = doc.data() as {
      parkId: string;
      rideId: string;
      dayType: DayType;
      p10: number;
      p90: number;
      sampleCount: number;
    };
    map.set(key(d.parkId, d.rideId, d.dayType), {
      p10: d.p10,
      p90: d.p90,
      sampleCount: d.sampleCount,
    });
  });
  return map;
}

export function ensureRideStatsLoaded(): Promise<Map<string, RideStats>> {
  if (!loadPromise) loadPromise = loadAll();
  return loadPromise;
}

export function lookupRideStats(
  statsMap: Map<string, RideStats>,
  parkSlug: ParkSlug,
  rideId: string,
  dayType: DayType
): RideStats | null {
  const parkId = PARKS[parkSlug].id;
  return statsMap.get(key(parkId, rideId, dayType)) ?? null;
}

export function _resetForTests(): void {
  loadPromise = null;
}
