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
import { Alert } from 'react-native';
import {
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
import {
  getNotificationsEnabled as readNotificationsEnabled,
  setNotificationsEnabled as writeNotificationsEnabled,
} from '../utils/notificationsEnabledStorage';
import {
  getDebugKeepArmed,
  setDebugKeepArmed as writeDebugKeepArmed,
} from '../utils/debugKeepArmedStorage';
import { getNotificationService, PushTokenType } from '../services/notifications';
import { logError, logInfo } from '../utils/logger';
import { NotificationKind, NotificationTypes, defaultNotificationTypes } from '../types';
import { usePersona } from './PersonaContext';
import { useDailyContext } from './DailyContextContext';
import { useTrip } from './TripContext';

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
  /** Debug-only: auto-arm + refresh token on every app launch. */
  debugKeepArmed: boolean;
  setDebugKeepArmed: (on: boolean) => Promise<void>;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const { persona } = usePersona();
  const { context: dailyContext } = useDailyContext();
  const { trip } = useTrip();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(false);
  const [armedDate, setArmedDate] = useState<string | null>(null);
  const [notificationTypes, setNotificationTypesState] = useState<NotificationTypes>(defaultNotificationTypes());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugKeepArmed, setDebugKeepArmedState] = useState(false);

  // Resolve the deviceId once on mount — generated on first launch and
  // persisted in AsyncStorage thereafter. Also hydrate cached flags.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [id, types, enabled, keepArmed] = await Promise.all([
        getOrCreateDeviceId(),
        getNotificationTypes(),
        readNotificationsEnabled(),
        getDebugKeepArmed(),
      ]);
      if (!cancelled) {
        setDeviceId(id);
        setNotificationTypesState(types);
        setNotificationsEnabled(enabled);
        setDebugKeepArmedState(keepArmed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-arm: when debugKeepArmed is on and the deviceId is ready, silently
  // arm + refresh the push token on every launch. Runs once per mount.
  const autoArmed = useRef(false);
  useEffect(() => {
    if (!debugKeepArmed || !deviceId || autoArmed.current) return;
    autoArmed.current = true;
    logInfo('debugKeepArmed: auto-arming on launch', 'notif');
    void armForTodayFn(deviceId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugKeepArmed, deviceId]);

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
    // Optimistic: flip the switch immediately so the UI doesn't freeze
    // while the async permission + registration work runs. On any failure
    // we revert below and surface an alert.
    setNotificationsEnabled(true);
    setBusy(true);
    setError(null);
    try {
      logInfo('enableNotifications: requesting permission', 'notif');
      const svc = getNotificationService();
      const permission = await svc.requestPermission();
      logInfo(`enableNotifications: permission = ${permission}`, 'notif');
      if (permission !== 'granted') {
        const msg = permission === 'unsupported'
          ? "This device doesn't support notifications yet."
          : 'Notification permission was denied.';
        setNotificationsEnabled(false);
        setError(msg);
        Alert.alert("Couldn't enable notifications", msg);
        return false;
      }
      // Use resubscribe (not getSubscription) so the browser drops any
      // cached subscription before handing us a token. Without this, a
      // dead subscription (e.g., one the push service has already 410'd
      // and our scanner nulled in Firestore) gets handed back unchanged
      // and we re-register the same dead endpoint — toggling off + on
      // becomes a no-op until the user clears site data.
      const sub = await svc.resubscribe();
      logInfo(`enableNotifications: token acquired (len ${sub?.token?.length ?? 0})`, 'notif');
      await registerDevice({
        deviceId,
        pushToken: sub?.token ?? null,
        pushTokenType: (sub?.type ?? null) as PushTokenType | null,
        mustDoRideIds: persona?.mustDoRideIds ?? [],
        notificationsEnabled: true,
        tripEnd: trip?.tripEnd ?? null,
      });
      logInfo('enableNotifications: device registered', 'notif');
      void writeNotificationsEnabled(true);
      lastSyncedMustDoRef.current = [...(persona?.mustDoRideIds ?? [])].sort().join(',');
      return true;
    } catch (err) {
      // Full diagnostic goes to the in-app log page; the inline line stays
      // generic so the Profile UI isn't cluttered with technical strings.
      const detail = err instanceof Error ? err.message : String(err);
      logError(`enableNotifications failed: ${detail}`, 'notif');
      setNotificationsEnabled(false);
      setError('Could not enable notifications');
      Alert.alert(
        "Couldn't enable notifications",
        "Something went wrong. Check your connection and try again."
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [deviceId, persona]);

  const disableNotifications = useCallback(async (): Promise<void> => {
    if (!deviceId) return;
    // Optimistic: flip off immediately. Revert + alert on failure.
    setNotificationsEnabled(false);
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
      void writeNotificationsEnabled(false);
      logInfo('disableNotifications: device cleared', 'notif');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logError(`disableNotifications failed: ${detail}`, 'notif');
      setNotificationsEnabled(true);
      setError('Could not disable notifications');
      Alert.alert(
        "Couldn't turn notifications off",
        "Something went wrong. Check your connection and try again."
      );
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

  // Core arm logic — called by both armForToday (user-triggered) and the
  // auto-arm effect (debugKeepArmed). Separated so the effect can call it
  // without needing the useCallback wrapper or the busy/error UI state.
  const armForTodayFn = useCallback(async (id: string): Promise<void> => {
    logInfo('armForToday: refreshing push subscription', 'notif');
    const svc = getNotificationService();
    const sub = await svc.resubscribe();
    logInfo(`armForToday: token acquired (len ${sub?.token?.length ?? 0})`, 'notif');
    await registerDevice({
      deviceId: id,
      pushToken: sub?.token ?? null,
      pushTokenType: (sub?.type ?? null) as PushTokenType | null,
      mustDoRideIds: persona?.mustDoRideIds ?? [],
      notificationsEnabled: true,
    });
    setNotificationsEnabled(true);
    void writeNotificationsEnabled(true);
    const { armedDate: stamped } = await armDeviceForToday(id);
    logInfo(`armForToday: armed for ${stamped}`, 'notif');
    setArmedDate(stamped);
  }, [persona]);

  const armForToday = useCallback(async (): Promise<void> => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      await armForTodayFn(deviceId);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logError(`armForToday failed: ${detail}`, 'notif');
      setError('Could not arm device');
    } finally {
      setBusy(false);
    }
  }, [deviceId, armForTodayFn]);

  const setDebugKeepArmed = useCallback(async (on: boolean): Promise<void> => {
    setDebugKeepArmedState(on);
    await writeDebugKeepArmed(on);
  }, []);

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
        debugKeepArmed,
        setDebugKeepArmed,
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
