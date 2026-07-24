// Shared ride-data provider. Both tabs (Browse + Recommendations) subscribe
// to this — the v0/waits fetch happens here once per app session, not per
// tab. Auto-refresh on a 10-min interval and on foreground after 10+ min
// of inactivity, matching the behavior the old Home owned locally.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { ApiError, fetchWaits } from '../api';
import { CombinedResponse, Ride } from '../types';
import { erroredParks } from '../grouping';
import { useAuth } from './AuthContext';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const STALE_FOREGROUND_THRESHOLD_MS = 10 * 60 * 1000;

interface RideContextValue {
  data: CombinedResponse | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  /** True while a silent auto-refresh (10-min interval / foreground) is in
   *  flight. Distinct from `refreshing`, which is the user's pull-to-refresh.
   *  Drives the "updating" spinner on the ride detail sheet. */
  backgroundRefreshing: boolean;
  lastRefreshedAt: string | null;
  refresh: (mode: 'user' | 'auto' | 'initial', at?: string) => Promise<void>;
  /** rideId → Ride lookup; used by the Recommendations screen to render rec cards
   *  from a slim rec payload that only carries rideIds. Empty until first fetch
   *  completes. */
  ridesById: Map<string, Ride>;
}

const RideContext = createContext<RideContextValue | null>(null);

export function RideProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<CombinedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const lastFetchedAtMs = useRef<number>(0);

  // Firebase token identifies the user so the backend includes premium fields
  // for entitled users. Held in a ref so `refresh` stays stable (its identity
  // feeds the interval/foreground effects) while always reading the latest.
  const { user, getIdToken } = useAuth();
  const getIdTokenRef = useRef(getIdToken);
  useEffect(() => {
    getIdTokenRef.current = getIdToken;
  }, [getIdToken]);

  const refresh = useCallback(
    async (mode: 'user' | 'auto' | 'initial', at?: string) => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'user') setRefreshing(true);
      if (mode === 'auto') setBackgroundRefreshing(true);
      const fetchedAt = new Date().toISOString();
      try {
        const token = await getIdTokenRef.current();
        const fresh = await fetchWaits(at, token);
        setData(fresh);
        lastFetchedAtMs.current = Date.now();
        if (mode !== 'initial') setLastRefreshedAt(fetchedAt);
        const failedParks = erroredParks(fresh);
        if (failedParks.length > 0) {
          setError(
            `Couldn't fetch live data for: ${failedParks.map(p => p.park).join(', ')}`
          );
        } else {
          setError(null);
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Unknown error';
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
        setBackgroundRefreshing(false);
      }
    },
    []
  );

  // Initial fetch on mount.
  useEffect(() => {
    void refresh('initial');
  }, [refresh]);

  // Auth resolves asynchronously after the initial fetch. When it first
  // becomes available (null → uid), silently refetch so an entitled user
  // upgrades from the token-less free-tier first paint to the full payload.
  const authUid = user?.uid ?? null;
  const prevAuthUid = useRef<string | null>(null);
  useEffect(() => {
    const was = prevAuthUid.current;
    prevAuthUid.current = authUid;
    if (!was && authUid) void refresh('auto');
  }, [authUid, refresh]);

  // Auto-refresh every 10 minutes while the app is open.
  useEffect(() => {
    const id = setInterval(() => void refresh('auto'), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Auto-refresh on foreground after 10+ minutes of inactivity.
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        const staleMs = Date.now() - lastFetchedAtMs.current;
        if (staleMs > STALE_FOREGROUND_THRESHOLD_MS) void refresh('auto');
      }
    });
    return () => sub.remove();
  }, [refresh]);

  // Derived: a flat rideId → Ride map for the Recommendations screen.
  const ridesById = useMemo(() => {
    const map = new Map<string, Ride>();
    if (!data) return map;
    for (const park of data.parks) {
      if ('error' in park) continue;
      for (const ride of park.rides) {
        map.set(ride.id, ride);
      }
    }
    return map;
  }, [data]);

  const value: RideContextValue = {
    data,
    error,
    loading,
    refreshing,
    backgroundRefreshing,
    lastRefreshedAt,
    refresh,
    ridesById,
  };

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

export function useRides(): RideContextValue {
  const ctx = useContext(RideContext);
  if (!ctx) {
    throw new Error('useRides must be used inside <RideProvider>');
  }
  return ctx;
}
