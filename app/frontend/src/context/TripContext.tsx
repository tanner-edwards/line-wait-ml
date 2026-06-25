// TripContext — exposes whether the current user has an active trip,
// and the bypass flag from their user record (developer elevated access).
//
// hasActiveTrip = trip exists AND today is within [tripStart - 1 day, tripEnd]
//              OR user.bypass === true (developer override)
//
// Trip data comes from GET /v1/users/trip on mount; refetch when explicitly
// called (e.g. after IAP completes).

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { TripRecord } from '../types';
import { useAuth } from './AuthContext';
import { fetchUserTrip } from '../api';

interface TripContextValue {
  hasActiveTrip: boolean;
  trip: TripRecord | null;
  loading: boolean;
  refetchTrip: () => Promise<void>;
}

const TripContext = createContext<TripContextValue>({
  hasActiveTrip: false,
  trip: null,
  loading: true,
  refetchTrip: async () => undefined,
});

function isTripActive(trip: TripRecord | null): boolean {
  if (!trip) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Allow entry one day before tripStart (travel day).
  const start = new Date(trip.tripStart + 'T00:00:00');
  start.setDate(start.getDate() - 1);

  const end = new Date(trip.tripEnd + 'T00:00:00');

  return today >= start && today <= end;
}

export function TripProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { user, userRecord, getIdToken } = useAuth();
  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTrip = useCallback(async () => {
    if (!user) {
      setTrip(null);
      setLoading(false);
      return;
    }
    try {
      const token = await getIdToken();
      if (!token) { setLoading(false); return; }
      const result = await fetchUserTrip(token);
      setTrip(result);
    } catch (err) {
      console.warn('[TripContext] fetchTrip failed:', err);
      setTrip(null);
    } finally {
      setLoading(false);
    }
  }, [user, getIdToken]);

  useEffect(() => {
    if (user) {
      setLoading(true);
      void loadTrip();
    } else {
      setTrip(null);
      setLoading(false);
    }
  }, [user, loadTrip]);

  const bypass = userRecord?.bypass ?? false;
  const isAnonymous = user?.isAnonymous ?? false;
  const hasActiveTrip = bypass || isAnonymous || isTripActive(trip);

  const refetchTrip = useCallback(async () => {
    setLoading(true);
    await loadTrip();
  }, [loadTrip]);

  return (
    <TripContext.Provider value={{ hasActiveTrip, trip, loading, refetchTrip }}>
      {children}
    </TripContext.Provider>
  );
}

export function useTrip(): TripContextValue {
  return useContext(TripContext);
}
