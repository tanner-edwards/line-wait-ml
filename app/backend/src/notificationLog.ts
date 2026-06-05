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
// The doc holds the LATEST fire per (deviceId, rideId, type). Cooldown
// overwrites on each new fire, so the history is effectively
// "last fire per type-and-ride for this device" — not a per-fire audit
// log. For 2-hour-window display purposes that's the right shape.

import { getFirestore } from './firestoreClient';

export interface NotificationLogEntry {
  deviceId: string;
  rideId: string;
  rideName: string | null;
  type: 'trough' | 'closure' | 'reopen';
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

/**
 * Returns recent notifications for the given device, sorted by firedAt
 * descending. `withinMs` filters out anything older (default 2 hours).
 */
export async function loadDeviceNotifications(
  deviceId: string,
  withinMs: number = 2 * 60 * 60 * 1000,
  now: Date = new Date()
): Promise<NotificationLogEntry[]> {
  const db = getFirestore();
  const snap = await db.collection('notification_log')
    .where('deviceId', '==', deviceId)
    .get();
  const cutoff = now.getTime() - withinMs;
  const entries: NotificationLogEntry[] = [];
  snap.forEach(doc => {
    const d = doc.data() as NotificationLogEntry;
    const ts = new Date(d.firedAt).getTime();
    if (Number.isFinite(ts) && ts >= cutoff) {
      entries.push(d);
    }
  });
  entries.sort((a, b) => b.firedAt.localeCompare(a.firedAt));
  return entries;
}
