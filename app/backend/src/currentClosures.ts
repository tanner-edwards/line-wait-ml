// Loads + looks up the `current_closures` collection that scanner.js
// maintains. One doc per ride that's currently DOWN, keyed by rideId.
// Used by the waits handler to enrich closed rides with the timestamp
// of when they went down so the frontend can render "Closed since X."
//
// Unlike historical_averages (loaded once per cold start), this collection
// changes every ~10 min as rides close and reopen, so we re-fetch per
// request. The collection is small (~5-15 rides typically) — cost is
// negligible compared to the snapshot fetch.

import { getFirestore } from './firestoreClient';

interface ClosureRecord {
  closedAt: string;
}

export async function loadCurrentClosures(): Promise<Map<string, ClosureRecord>> {
  const db = getFirestore();
  const snap = await db.collection('current_closures').get();
  const map = new Map<string, ClosureRecord>();
  snap.forEach(doc => {
    const d = doc.data() as { rideId: string; closedAt: string };
    if (d.rideId && d.closedAt) {
      map.set(d.rideId, { closedAt: d.closedAt });
    }
  });
  return map;
}

export function lookupClosedAt(
  map: Map<string, ClosureRecord>,
  rideId: string
): string | null {
  return map.get(rideId)?.closedAt ?? null;
}
