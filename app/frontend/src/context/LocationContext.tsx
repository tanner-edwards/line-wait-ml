import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { haversineMeters } from '../grouping';

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

// getCurrentPositionAsync has no built-in timeout — guard against a GPS fix
// hanging indefinitely (e.g. poor signal indoors).
const GPS_TIMEOUT_MS = 10_000;
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('location timeout')), ms)),
  ]);
}

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
  const [gpsCoords, setGpsCoords] = useState<LocationCoords | null>(null);
  const [gpsStatus, setGpsStatus] = useState<LocationStatus>('idle');
  const [debugCoords, setDebugCoordsState] = useState<LocationCoords | null>(null);

  const fetchGPS = useCallback(() => {
    setGpsStatus('locating');
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setGpsStatus('denied');
          return;
        }
        const pos = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          GPS_TIMEOUT_MS
        );
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setGpsCoords({ lat, lng });
        setGpsStatus(isInPark(lat, lng) ? 'ready' : 'out-of-park');
      } catch {
        setGpsStatus('denied');
      }
    })();
  }, []);

  useEffect(() => {
    fetchGPS();
  }, [fetchGPS]);

  const setDebugCoords = useCallback((lat: number, lng: number) => {
    setDebugCoordsState({ lat, lng });
  }, []);

  const clearDebugCoords = useCallback(() => {
    setDebugCoordsState(null);
  }, []);

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
