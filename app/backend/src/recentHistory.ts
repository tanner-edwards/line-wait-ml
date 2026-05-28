import * as admin from 'firebase-admin';
import { getFirestore } from './firestoreClient';
import { ParkSlug, PARKS, RecentSnapshot } from './types';

export async function fetchRecentHistory(
  parkSlug: ParkSlug,
  referenceDate: Date
): Promise<Map<string, RecentSnapshot[]>> {
  const db = getFirestore();
  const parkId = PARKS[parkSlug].id;
  const upperBound = new Date(referenceDate.getTime() - 8 * 60_000);
  const lowerBound = new Date(referenceDate.getTime() - 45 * 60_000);

  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await db
      .collection('wait_times')
      .where('park_id', '==', parkId)
      .where('timestamp_utc', '>=', lowerBound)
      .where('timestamp_utc', '<', upperBound)
      .orderBy('timestamp_utc', 'desc')
      .get();
  } catch (err) {
    console.warn('recentHistory query failed; serving without recent history', err);
    return new Map();
  }

  const map = new Map<string, RecentSnapshot[]>();
  snap.forEach(doc => {
    const d = doc.data() as {
      ride_id: string;
      wait_minutes: number | null | undefined;
      status: string | undefined;
      timestamp_utc: admin.firestore.Timestamp;
    };
    const rideId = d.ride_id;
    const existing = map.get(rideId) ?? [];
    if (existing.length >= 2) return;
    const ts = d.timestamp_utc.toDate();
    existing.push({
      timestamp: ts.toISOString(),
      minutesAgo: Math.round((referenceDate.getTime() - ts.getTime()) / 60_000),
      wait: d.wait_minutes ?? null,
      status: d.status ?? 'UNKNOWN',
    });
    map.set(rideId, existing);
  });

  return map;
}

// No module state — exported as a no-op for test symmetry with other modules.
export function _resetForTests(): void {}
