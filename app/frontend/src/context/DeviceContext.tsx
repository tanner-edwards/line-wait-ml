// Device-scope state: the anonymous deviceId + the notification opt-in /
// arm state we mirror locally for the Profile UI. The provider also
// keeps the backend's mustDoRideIds in sync with PersonaContext so the
// scanner always has a fresh list when it considers a device.
//
// All backend writes are best-effort — failures don't block the user
// from continuing to use the app; local state still reflects intent.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ApiError,
  armDeviceForToday,
  registerDevice,
  syncDailyParks,
  syncMustDoRideIds,
  syncNotificationTypes,
} from '../api';
import { getOrCreateDeviceId } from '../utils/deviceStorage';
import {
  getNotificationTypes,
  setNotificationTypes as writeNotificationTypes,
} from '../utils/notificationTypesStorage';
import { getNotificationService, PushTokenType } from '../services/notifications';
import { NotificationKind, NotificationTypes, defaultNotificationTypes } from '../types';
import { usePersona } from './PersonaContext';
import { useDailyContext } from './DailyContextContext';

interface DeviceContextValue {
  deviceId: string | null;
  notificationsEnabled: boolean;
  armedDate: string | null;
  /** Per-type opt-ins. Default all true; user toggles from Profile. */
  notificationTypes: NotificationTypes;
  /** True while a request to /v1/devices is in flight. */
  busy: boolean;
  /** Last user-facing error from a /v1/devices call. Reset on next attempt. */
  error: string | null;
  /**
   * Request OS permission, get a push subscription if available, and
   * register the device with the backend. Returns true on success.
   */
  enableNotifications: () => Promise<boolean>;
  /** Flip notificationsEnabled to false in the backend record. */
  disableNotifications: () => Promise<void>;
  /** Stamp armedDate = today (Pacific) on the device record. */
  armForToday: () => Promise<void>;
  /** Toggle a single notification kind on/off. Persists locally + syncs. */
  setNotificationTypeEnabled: (kind: NotificationKind, enabled: boolean) => Promise<void>;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const { persona } = usePersona();
  const { context: dailyContext } = useDailyContext();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(false);
  const [armedDate, setArmedDate] = useState<string | null>(null);
  const [notificationTypes, setNotificationTypesState] = useState<NotificationTypes>(defaultNotificationTypes());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the deviceId once on mount — generated on first launch and
  // persisted in AsyncStorage thereafter. Also hydrate the cached
  // notificationTypes from AsyncStorage.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [id, types] = await Promise.all([
        getOrCreateDeviceId(),
        getNotificationTypes(),
      ]);
      if (!cancelled) {
        setDeviceId(id);
        setNotificationTypesState(types);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync mustDoRideIds to backend whenever the persona's list changes,
  // but only after enable has been turned on (no point creating server
  // records for users who never opted in).
  const lastSyncedMustDoRef = useRef<string>('');
  useEffect(() => {
    if (!deviceId || !notificationsEnabled || !persona) return;
    const ids = persona.mustDoRideIds;
    const fingerprint = [...ids].sort().join(',');
    if (fingerprint === lastSyncedMustDoRef.current) return;
    lastSyncedMustDoRef.current = fingerprint;
    void syncMustDoRideIds(deviceId, ids).catch(err => {
      // Best-effort — log but don't surface to the user, the next change
      // will retry the sync.
      console.warn('syncMustDoRideIds failed', err);
    });
  }, [deviceId, notificationsEnabled, persona]);

  // Same pattern for dailyParks: sync the daily park scope so the scanner
  // can filter must-do rides to the park(s) the user said they're at today.
  const lastSyncedDailyParksRef = useRef<string>('');
  useEffect(() => {
    if (!deviceId || !notificationsEnabled || !dailyContext) return;
    const parks = dailyContext.parks;
    if (parks === lastSyncedDailyParksRef.current) return;
    lastSyncedDailyParksRef.current = parks;
    void syncDailyParks(deviceId, parks).catch(err => {
      console.warn('syncDailyParks failed', err);
    });
  }, [deviceId, notificationsEnabled, dailyContext]);

  // Sync notificationTypes when they first become syncable (notifications
  // just turned on). Subsequent edits go through setNotificationTypeEnabled
  // which syncs inline.
  const lastSyncedTypesRef = useRef<string>('');
  useEffect(() => {
    if (!deviceId || !notificationsEnabled) return;
    const fingerprint = JSON.stringify(notificationTypes);
    if (fingerprint === lastSyncedTypesRef.current) return;
    lastSyncedTypesRef.current = fingerprint;
    void syncNotificationTypes(deviceId, notificationTypes).catch(err => {
      console.warn('syncNotificationTypes failed', err);
    });
  }, [deviceId, notificationsEnabled, notificationTypes]);

  const enableNotifications = useCallback(async (): Promise<boolean> => {
    if (!deviceId) return false;
    setBusy(true);
    setError(null);
    try {
      const svc = getNotificationService();
      const permission = await svc.requestPermission();
      if (permission !== 'granted') {
        setError(
          permission === 'unsupported'
            ? "This device doesn't support notifications yet."
            : 'Notification permission was denied.'
        );
        return false;
      }
      // Use resubscribe (not getSubscription) so the browser drops any
      // cached subscription before handing us a token. Without this, a
      // dead subscription (e.g., one the push service has already 410'd
      // and our scanner nulled in Firestore) gets handed back unchanged
      // and we re-register the same dead endpoint — toggling off + on
      // becomes a no-op until the user clears site data.
      const sub = await svc.resubscribe();
      await registerDevice({
        deviceId,
        pushToken: sub?.token ?? null,
        pushTokenType: (sub?.type ?? null) as PushTokenType | null,
        mustDoRideIds: persona?.mustDoRideIds ?? [],
        notificationsEnabled: true,
      });
      setNotificationsEnabled(true);
      lastSyncedMustDoRef.current = [...(persona?.mustDoRideIds ?? [])].sort().join(',');
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not enable notifications';
      setError(message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [deviceId, persona]);

  const disableNotifications = useCallback(async (): Promise<void> => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      await registerDevice({
        deviceId,
        pushToken: null,
        pushTokenType: null,
        mustDoRideIds: persona?.mustDoRideIds ?? [],
        notificationsEnabled: false,
      });
      setNotificationsEnabled(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not disable notifications';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [deviceId, persona]);

  const setNotificationTypeEnabled = useCallback(
    async (kind: NotificationKind, enabled: boolean): Promise<void> => {
      const next: NotificationTypes = { ...notificationTypes, [kind]: enabled };
      setNotificationTypesState(next);
      await writeNotificationTypes(next);
      if (deviceId && notificationsEnabled) {
        void syncNotificationTypes(deviceId, next).catch(err => {
          console.warn('syncNotificationTypes failed', err);
        });
      }
    },
    [deviceId, notificationsEnabled, notificationTypes]
  );

  const armForToday = useCallback(async (): Promise<void> => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      const { armedDate: stamped } = await armDeviceForToday(deviceId);
      setArmedDate(stamped);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not arm device';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [deviceId]);

  return (
    <DeviceContext.Provider
      value={{
        deviceId,
        notificationsEnabled,
        armedDate,
        notificationTypes,
        busy,
        error,
        enableNotifications,
        disableNotifications,
        armForToday,
        setNotificationTypeEnabled,
      }}
    >
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDevice must be used inside <DeviceProvider>');
  return ctx;
}
