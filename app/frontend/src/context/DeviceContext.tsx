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
  syncMustDoRideIds,
} from '../api';
import { getOrCreateDeviceId } from '../utils/deviceStorage';
import { getNotificationService, PushTokenType } from '../services/notifications';
import { usePersona } from './PersonaContext';

interface DeviceContextValue {
  deviceId: string | null;
  notificationsEnabled: boolean;
  armedDate: string | null;
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
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const { persona } = usePersona();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(false);
  const [armedDate, setArmedDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the deviceId once on mount — generated on first launch and
  // persisted in AsyncStorage thereafter.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = await getOrCreateDeviceId();
      if (!cancelled) setDeviceId(id);
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
      const sub = await svc.getSubscription();
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
        busy,
        error,
        enableNotifications,
        disableNotifications,
        armForToday,
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
