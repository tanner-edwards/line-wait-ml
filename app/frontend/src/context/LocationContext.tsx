import React, { createContext, useCallback, useContext, useState } from 'react';
import { ParkSlug } from '../types';

export interface LocationSelection {
  park: ParkSlug;
  currentRideId: string;
}

interface LocationContextValue {
  selection: LocationSelection | null;
  setLocation: (sel: LocationSelection | null) => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [selection, setSelectionState] = useState<LocationSelection | null>(null);

  const setLocation = useCallback((sel: LocationSelection | null) => {
    setSelectionState(sel);
  }, []);

  return (
    <LocationContext.Provider value={{ selection, setLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside <LocationProvider>');
  return ctx;
}
