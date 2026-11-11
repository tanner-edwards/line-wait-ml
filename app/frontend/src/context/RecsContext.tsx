// Shared recommendation list for the Recommendations tab's stack — the main
// screen (top picks + tiles) and More to Consider read the same list, so a
// Show more on one or a swipe-to-ridden on either is reflected in both.
//
// The main screen still owns the initial fetch (location/focus gating lives
// there) and hands the result over via setInitialRecs. Everything that
// appends — loadMore — lives here so either screen can call it.

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ApiError, fetchRecommendations } from '../api';
import { RecommendationsResponse } from '../types';
import { useAuth } from './AuthContext';
import { useDevice } from './DeviceContext';
import { useLocation } from './LocationContext';
import { usePersona } from './PersonaContext';
import { useRides } from './RideContext';

interface RecsContextValue {
  recs: RecommendationsResponse | null;
  /** How many recs the initial fetch returned. Recs past this index came from
   *  Show more and belong to More to Consider, not the main screen's tiles —
   *  derived from the response so the backend batch size isn't hard-coded. */
  firstBatchCount: number;
  /** Replaces the list with a fresh first batch; cancels any in-flight loadMore. */
  setInitialRecs: (next: RecommendationsResponse | null) => void;
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  loadMoreError: string | null;
}

const RecsContext = createContext<RecsContextValue | null>(null);

export function RecsProvider({ children }: { children: React.ReactNode }) {
  const { getIdToken } = useAuth();
  const { retiredRideIds } = useDevice();
  const { coords } = useLocation();
  const { persona } = usePersona();
  const { timeTravelAt } = useRides();

  const [recs, setRecs] = useState<RecommendationsResponse | null>(null);
  const [firstBatchCount, setFirstBatchCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadMoreAbort = useRef<AbortController | null>(null);

  const setInitialRecs = useCallback((next: RecommendationsResponse | null) => {
    loadMoreAbort.current?.abort();
    setLoadingMore(false);
    setLoadMoreError(null);
    setRecs(next);
    setFirstBatchCount(next?.recommendations.length ?? 0);
  }, []);

  const loadMore = useCallback(async () => {
    if (!recs || !coords) return;
    loadMoreAbort.current?.abort();
    const controller = new AbortController();
    loadMoreAbort.current = controller;

    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const idToken = await getIdToken();
      const res = await fetchRecommendations({
        park: recs.park,
        userLat: coords.lat,
        userLng: coords.lng,
        persona,
        excludeRideIds: [...recs.recommendations.map(r => r.rideId), ...retiredRideIds],
        signal: controller.signal,
        idToken,
        at: timeTravelAt ?? undefined,
      });
      if (controller.signal.aborted) return;
      setRecs(prev => prev
        ? {
            ...res,
            currentRide: prev.currentRide,
            lastUpdated: prev.lastUpdated,
            degraded: prev.degraded,
            recommendations: [...prev.recommendations, ...res.recommendations],
            hasMore: res.hasMore,
          }
        : res
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message = err instanceof ApiError ? err.message : 'Unknown error';
      setLoadMoreError(message);
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [recs, coords, persona, getIdToken, retiredRideIds, timeTravelAt]);

  return (
    <RecsContext.Provider
      value={{ recs, firstBatchCount, setInitialRecs, loadMore, loadingMore, loadMoreError }}
    >
      {children}
    </RecsContext.Provider>
  );
}

export function useRecs(): RecsContextValue {
  const ctx = useContext(RecsContext);
  if (!ctx) throw new Error('useRecs must be used inside <RecsProvider>');
  return ctx;
}
