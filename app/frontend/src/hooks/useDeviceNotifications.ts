// Stale-while-revalidate hook for the per-device notification history.
//
// On first call (or whenever `enabled` flips true), reads the cached list
// from AsyncStorage and returns it immediately so the UI has something to
// show. Then fires the real fetch in the background and replaces the list
// when it lands.
//
// Errors only surface when there's nothing cached to display — otherwise
// the cached view stays put and we fail silently.

import { useCallback, useEffect, useState } from 'react';
import { ApiError, fetchDeviceNotifications } from '../api';
import { NotificationLogEntry } from '../types';
import {
  getCachedNotifications,
  setCachedNotifications,
} from '../utils/notificationHistoryStorage';

export interface DeviceNotificationsState {
  entries: NotificationLogEntry[] | null;
  refreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDeviceNotifications(
  deviceId: string | null,
  enabled: boolean,
): DeviceNotificationsState {
  const [entries, setEntries] = useState<NotificationLogEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!deviceId) return;

    const cached = await getCachedNotifications(deviceId);
    if (cached) setEntries(cached);

    setRefreshing(true);
    setError(null);
    try {
      const next = await fetchDeviceNotifications(deviceId);
      setEntries(next);
      void setCachedNotifications(deviceId, next);
    } catch (err) {
      if (!cached) {
        const message = err instanceof ApiError ? err.message : 'Could not load notifications';
        setError(message);
      }
    } finally {
      setRefreshing(false);
    }
  }, [deviceId]);

  useEffect(() => {
    if (enabled) void refetch();
  }, [enabled, refetch]);

  return { entries, refreshing, error, refetch };
}
