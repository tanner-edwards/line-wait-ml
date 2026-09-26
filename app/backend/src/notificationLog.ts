// Reads from the notification_log collection scanner.js writes to.
// Used by GET /v1/devices/:id/notifications so the in-app history sheet
// can render the user's recent notifications.
//
// Schema (set by scanner.js):
//   doc id: ${deviceId}__${rideId}__${type}
//   { deviceId, rideId, rideName, type, badge, firedAt, expiresAt,
//     currentWait, delivered, deliveryError, plus type-specific fields
//     (bucket0Wait, rideStats, previousWait, closedAt, durationMs) }
//
// Append-only: one doc per fire, auto-generated ID. Cooldown state lives
// separately in `notification_cooldowns` — it previously shared this
// collection via a `${deviceId}__${rideId}__${type}` doc ID, which made each
// fire overwrite the last and silently dropped most of the user's history
// (a 30-min cooldown allows up to 4 fires per ride+type inside the 2-hour
// display window). Entries are pruned by a Firestore TTL policy on
// `expiresAt`; nothing in code deletes them.

import { getFirestore } from './firestoreClient';

export interface NotificationLogEntry {
  deviceId: string;
  rideId: string;
  rideName: string | null;
  type: 'trough' | 'closure' | 'reopen' | 'peak';
  badge: 'star' | 'go' | null;
  firedAt: string;
  expiresAt: string;
  currentWait: number | null;
  delivered: boolean;
  deliveryError: string | null;
  // The body the scanner sent in the push payload. Persisted so the
  // in-app history shows the same text the user got, rather than
  // re-rolling a random tagline on every render.
  body?: string | null;
  // Type-specific extras — present on some types only.
  bucket0Wait?: number | null;
  rideStats?: { p10: number; p50: number; p90: number; sampleCount: number } | null;
  previousWait?: number | null;
  closedAt?: string | null;
  durationMs?: number | null;
}

// Caps how many entries one history request can read. Well above what the
// 2-hour window can realistically hold, so it acts as a runaway guard rather
// than a visible limit.
const MAX_ENTRIES = 100;

/**
 * Returns recent notifications for the given device, sorted by firedAt
 * descending. `withinMs` filters out anything older (default 2 hours).
 *
 * The date filter and ordering are applied server-side: this collection is
 * append-only and never pruned in code, so an unfiltered read would fetch
 * every notification the device has ever received (billed per doc) just to
 * display the last couple of hours.
 *
 * Requires a composite index on (deviceId ASC, firedAt DESC).
 */
export async function loadDeviceNotifications(
  deviceId: string,
  withinMs: number = 2 * 60 * 60 * 1000,
  now: Date = new Date()
): Promise<NotificationLogEntry[]> {
  const db = getFirestore();
  const cutoffIso = new Date(now.getTime() - withinMs).toISOString();
  const snap = await db.collection('notification_log')
    .where('deviceId', '==', deviceId)
    .where('firedAt', '>=', cutoffIso)
    .orderBy('firedAt', 'desc')
    .limit(MAX_ENTRIES)
    .get();
  const entries: NotificationLogEntry[] = [];
  snap.forEach(doc => {
    const d = doc.data() as NotificationLogEntry;
    // A log entry is written even when the push failed, so that a delivery
    // error is recoverable for debugging. Don't show the user history for a
    // notification that never reached them.
    if (d.delivered === false) return;
    entries.push(d);
  });
  return entries;
}
