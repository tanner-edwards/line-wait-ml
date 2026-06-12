// Owns the "recent alerts for this ride" data fetch. Reads the cached
// device notifications first (so the tile populates instantly), then
// fetches fresh and filters to the given rideId. Silent on errors —
// the tile just doesn't render when we have no entries.
//
// TRIAL note (inherited from the previous in-modal implementation): the
// backend stores notification_log with doc ID `deviceId__rideId__type`,
// overwritten each cooldown cycle. So at most 4 entries per ride exist
// here. If the tile proves useful, swap to an append-only history
// collection so users see a real audit log.

import { useCallback, useEffect, useState } from 'react';
import { fetchDeviceNotifications } from '../api';
import { getCachedNotifications } from '../utils/notificationHistoryStorage';
import { NotificationLogEntry } from '../types';

export function useRideNotificationHistory(
  deviceId: string | null,
  rideId: string,
): NotificationLogEntry[] {
  const [entries, setEntries] = useState<NotificationLogEntry[]>([]);

  const load = useCallback(async () => {
    if (!deviceId) return;
    const cached = await getCachedNotifications(deviceId);
    const base = cached ?? [];
    const filtered = base.filter(e => e.rideId === rideId);
    if (filtered.length) setEntries(filtered);
    try {
      const fresh = await fetchDeviceNotifications(deviceId);
      setEntries(fresh.filter(e => e.rideId === rideId));
    } catch {
      // already showing cached or nothing — silent fail
    }
  }, [deviceId, rideId]);

  useEffect(() => { void load(); }, [load]);

  return entries;
}
