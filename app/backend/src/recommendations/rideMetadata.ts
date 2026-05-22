// Loads + looks up ride_metadata docs seeded by cron/populate_ride_metadata.py.
// Module-scope cache: load once per Lambda cold start, hold forever (metadata
// changes only when new attractions open — bootstrap re-run is the trigger,
// not a TTL refresh).
//
// Same lazy-init shape as historicalAverages.ts and rideStats.ts.

import { getFirestore } from '../firestoreClient';
import { RideMetadata } from '../types';

let loadPromise: Promise<Map<string, RideMetadata>> | null = null;

async function loadAll(): Promise<Map<string, RideMetadata>> {
  const db = getFirestore();
  const snap = await db.collection('ride_metadata').get();
  const map = new Map<string, RideMetadata>();
  snap.forEach(doc => {
    const d = doc.data() as RideMetadata;
    map.set(d.rideId, d);
  });
  return map;
}

export function ensureRideMetadataLoaded(): Promise<Map<string, RideMetadata>> {
  if (!loadPromise) loadPromise = loadAll();
  return loadPromise;
}

/**
 * Look up metadata for a single ride by its themeparks UUID. Returns null
 * when the ride is missing from the collection (e.g. a new attraction that
 * hasn't been added to ride_metadata.json + re-seeded yet).
 */
export function lookupRideMetadata(
  map: Map<string, RideMetadata>,
  rideId: string
): RideMetadata | null {
  return map.get(rideId) ?? null;
}

// Test helper: clear the module-level lazy-load.
export function _resetForTests(): void {
  loadPromise = null;
}
