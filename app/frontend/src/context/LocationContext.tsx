import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { haversineMeters } from '../grouping';
import { useDebugMode } from './DebugModeContext';

export type LocationStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'out-of-park';

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

// expo-location's watch/position calls have no built-in timeout — guard
// against establishing a watch hanging indefinitely (e.g. poor signal indoors).
const GPS_TIMEOUT_MS = 10_000;
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('location timeout')), ms)),
  ]);
}

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
  /** Re-requests permission + fetches position — use for retry buttons after denial. */
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

  const fetchGPS = useCallback(() => {
    watchSubscription.current?.remove();
    watchSubscription.current = null;
    setGpsStatus('locating');
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setGpsStatus('denied');
          return;
        }
        const sub = await withTimeout(
          Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              timeInterval: GPS_WATCH_TIME_INTERVAL_MS,
              distanceInterval: GPS_WATCH_DISTANCE_INTERVAL_M,
            },
            pos => {
              const lat = pos.coords.latitude;
              const lng = pos.coords.longitude;
              setGpsCoords({ lat, lng });
              setGpsStatus(isInPark(lat, lng) ? 'ready' : 'out-of-park');
            }
          ),
          GPS_TIMEOUT_MS
        );
        watchSubscription.current = sub;
      } catch {
        setGpsStatus('denied');
      }
    })();
  }, []);

  useEffect(() => {
    fetchGPS();
    return () => {
      watchSubscription.current?.remove();
      watchSubscription.current = null;
    };
  }, [fetchGPS]);

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
    <LocationContext.Provider value={{ coords, status, retry: fetchGPS, setDebugCoords, clearDebugCoords }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside <LocationProvider>');
  return ctx;
}
