import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { haversineMeters } from '../grouping';
import { useDebugMode } from './DebugModeContext';

// 'needs-permission' and 'denied' are deliberately distinct. Collapsing them
// (any non-granted result → "denied" → "Open Settings") got the app rejected
// under App Store guideline 5.1.1(iv): a user who had never been asked was
// being sent to Settings instead of seeing the OS dialog. Settings is only a
// legitimate destination once iOS refuses to prompt again.
export type LocationStatus =
  | 'idle'
  | 'needs-permission'
  | 'locating'
  | 'ready'
  | 'denied'
  | 'gps-error'
  | 'out-of-park';

export interface LocationCoords {
  lat: number;
  lng: number;
}

// One entry per park — user is "in the park" if within any radius.
const PARK_CENTERS = [
  { lat: 33.8121, lng: -117.9190, radiusM: 600 }, // Disneyland
  { lat: 33.8058, lng: -117.9218, radiusM: 500 }, // DCA
] as const;

function isInPark(lat: number, lng: number): boolean {
  return PARK_CENTERS.some(p => haversineMeters(lat, lng, p.lat, p.lng) <= p.radiusM);
}

// A watch can establish successfully and still never deliver a fix — Wi-Fi-only
// iPads have no GPS chip, and a cold fix indoors can take a very long time. So
// the timeout is on receiving the first position, not on the subscription call.
const GPS_FIRST_FIX_TIMEOUT_MS = 15_000;

// A single getCurrentPositionAsync() fix is often the WORST one of a session —
// cold GPS chip, especially indoors/near tall rides — and there was no way to
// ever get a better one short of an app restart. Watch instead: update on
// meaningful movement or periodically, so accuracy improves over time and
// walking to a new area is reflected without the user doing anything.
const GPS_WATCH_TIME_INTERVAL_MS = 15_000;
const GPS_WATCH_DISTANCE_INTERVAL_M = 20;

interface LocationContextValue {
  /** GPS coords (or debug override), null while locating or on failure. */
  coords: LocationCoords | null;
  status: LocationStatus;
  /**
   * Shows the native OS permission dialog. Call only from a user gesture —
   * iOS silently drops the request when the app isn't foreground-active, which
   * is why this never runs on mount.
   */
  requestPermission: () => void;
  /** Re-checks permission and restarts the watch — for retry buttons. */
  retry: () => void;
  /** Debug mode: inject fake coordinates from a ride picker, bypassing GPS. */
  setDebugCoords: (lat: number, lng: number) => void;
  clearDebugCoords: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { debugMode } = useDebugMode();
  const [gpsCoords, setGpsCoords] = useState<LocationCoords | null>(null);
  const [gpsStatus, setGpsStatus] = useState<LocationStatus>('idle');
  const [debugCoords, setDebugCoordsState] = useState<LocationCoords | null>(null);
  const watchSubscription = useRef<Location.LocationSubscription | null>(null);
  const firstFixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startToken = useRef(0);

  const clearFirstFixTimer = useCallback(() => {
    if (firstFixTimer.current) {
      clearTimeout(firstFixTimer.current);
      firstFixTimer.current = null;
    }
  }, []);

  const teardownWatch = useCallback(() => {
    startToken.current += 1;
    watchSubscription.current?.remove();
    watchSubscription.current = null;
    clearFirstFixTimer();
  }, [clearFirstFixTimer]);

  const startWatch = useCallback(async () => {
    teardownWatch();
    const token = startToken.current;
    const isCurrent = () => startToken.current === token;

    setGpsStatus('locating');
    firstFixTimer.current = setTimeout(() => {
      firstFixTimer.current = null;
      if (isCurrent()) setGpsStatus(prev => (prev === 'locating' ? 'gps-error' : prev));
    }, GPS_FIRST_FIX_TIMEOUT_MS);

    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: GPS_WATCH_TIME_INTERVAL_MS,
          distanceInterval: GPS_WATCH_DISTANCE_INTERVAL_M,
        },
        pos => {
          if (!isCurrent()) return;
          clearFirstFixTimer();
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setGpsCoords({ lat, lng });
          setGpsStatus(isInPark(lat, lng) ? 'ready' : 'out-of-park');
        },
        () => {
          if (!isCurrent()) return;
          clearFirstFixTimer();
          setGpsStatus('gps-error');
        }
      );
      // A newer start (or unmount) happened while this one was in flight.
      if (!isCurrent()) {
        sub.remove();
        return;
      }
      watchSubscription.current = sub;
    } catch {
      if (!isCurrent()) return;
      clearFirstFixTimer();
      setGpsStatus('gps-error');
    }
  }, [teardownWatch, clearFirstFixTimer]);

  const applyPermission = useCallback(
    ({ status, canAskAgain }: Location.LocationPermissionResponse) => {
      if (status === Location.PermissionStatus.GRANTED) {
        void startWatch();
        return;
      }
      // UNDETERMINED means the dialog was never shown or never answered. That
      // is not a denial — the user still needs to see the OS prompt.
      setGpsStatus(
        status === Location.PermissionStatus.UNDETERMINED || canAskAgain
          ? 'needs-permission'
          : 'denied'
      );
    },
    [startWatch]
  );

  /** Reads current permission WITHOUT prompting — safe to call on mount. */
  const syncPermission = useCallback(async () => {
    try {
      applyPermission(await Location.getForegroundPermissionsAsync());
    } catch {
      setGpsStatus('needs-permission');
    }
  }, [applyPermission]);

  const requestPermission = useCallback(async () => {
    try {
      applyPermission(await Location.requestForegroundPermissionsAsync());
    } catch {
      setGpsStatus('needs-permission');
    }
  }, [applyPermission]);

  useEffect(() => {
    void syncPermission();
    return teardownWatch;
  }, [syncPermission, teardownWatch]);

  // "Turn it on in Settings, then come back" only works if coming back actually
  // re-checks. Limited to the two stuck states so it can't restart a healthy
  // watch or race an in-flight permission request.
  const statusRef = useRef(gpsStatus);
  statusRef.current = gpsStatus;
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      if (statusRef.current !== 'denied' && statusRef.current !== 'gps-error') return;
      void syncPermission();
    });
    return () => sub.remove();
  }, [syncPermission]);

  const setDebugCoords = useCallback((lat: number, lng: number) => {
    setDebugCoordsState({ lat, lng });
  }, []);

  const clearDebugCoords = useCallback(() => {
    setDebugCoordsState(null);
  }, []);

  // Turning debug mode off must always restore real GPS immediately — the
  // debug ride picker's injected coords otherwise stick around forever
  // (nothing else clears them), silently overriding real GPS that's still
  // being fetched correctly underneath.
  useEffect(() => {
    if (!debugMode) setDebugCoordsState(null);
  }, [debugMode]);

  const coords = debugCoords ?? gpsCoords;
  const status: LocationStatus = debugCoords ? 'ready' : gpsStatus;

  return (
    <LocationContext.Provider
      value={{
        coords,
        status,
        requestPermission,
        retry: syncPermission,
        setDebugCoords,
        clearDebugCoords,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside <LocationProvider>');
  return ctx;
}
