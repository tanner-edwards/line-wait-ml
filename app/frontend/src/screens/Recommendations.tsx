// Recommendations screen — v4.
//
// Location flow:
//   GPS ready  → auto-fetch with user coordinates; backend derives nearest ride
//   GPS denied → "Location access denied" prompt
//   Out of park → "You don't appear to be in the park" + Retry
//   Debug mode → ride picker (OPERATING rides only) injects fake GPS coords

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ApiError, fetchRecommendations } from '../api';
import { DailyContext, ParkSlug, RecommendationsResponse, Ride } from '../types';
import { useRides } from '../context/RideContext';
import { usePersona } from '../context/PersonaContext';
import { useDailyContext } from '../context/DailyContextContext';
import { useLocation } from '../context/LocationContext';
import { useDebugMode } from '../context/DebugModeContext';
import { PickerSheet, parkDisplayName } from '../components/PickerSheet';
import { RecommendationCard } from '../components/RecommendationCard';
import { NotificationBellButton } from '../components/NotificationBellButton';
import { formatHHMM } from '../timestamp';
import { haversineMeters } from '../grouping';

const LOADING_LINES = [
  'Looking around the park…',
  'Reading the lines…',
  'Picking your next move…',
  'Checking who has elbow room…',
];

const DLR_CENTER = { lat: 33.8121, lng: -117.9190 };
const DCA_CENTER = { lat: 33.8058, lng: -117.9218 };

function derivePark(lat: number, lng: number, dailyParks: DailyContext['parks'] | undefined): ParkSlug {
  if (dailyParks === 'disneyland') return 'disneyland';
  if (dailyParks === 'california-adventure') return 'california-adventure';
  const dlr = haversineMeters(lat, lng, DLR_CENTER.lat, DLR_CENTER.lng);
  const dca = haversineMeters(lat, lng, DCA_CENTER.lat, DCA_CENTER.lng);
  return dlr <= dca ? 'disneyland' : 'california-adventure';
}

export function Recommendations(): React.ReactElement {
  const { data, error: waitsError, loading: waitsLoading, ridesById } = useRides();
  const { persona } = usePersona();
  const { context: dailyContext } = useDailyContext();
  const { coords, status, retry, setDebugCoords } = useLocation();
  const { debugMode } = useDebugMode();

  const [recs, setRecs] = useState<RecommendationsResponse | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [expandedRideId, setExpandedRideId] = useState<string | null>(null);
  const [debugPickerOpen, setDebugPickerOpen] = useState(false);

  const inFlightAbort = useRef<AbortController | null>(null);
  const loadMoreAbort = useRef<AbortController | null>(null);

  const loadingLine = useMemo(
    () => LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recsLoading]
  );

  // Rides filtered to OPERATING with a real wait — used by the debug picker
  // so the list is short and every entry is a plausible "I'm here" location.
  const ridesByParkForPicker = useMemo<Record<ParkSlug, Ride[]>>(() => {
    const out: Record<ParkSlug, Ride[]> = { disneyland: [], 'california-adventure': [] };
    if (!data) return out;
    for (const slug of Object.keys(out) as ParkSlug[]) {
      const parkData = data.parks.find(p => p.park === parkDisplayName(slug));
      if (parkData && !('error' in parkData)) {
        out[slug] = parkData.rides.filter(r => r.status === 'OPERATING' && r.currentWait !== null);
      }
    }
    return out;
  }, [data]);

  const isParkOpen = useCallback((park: ParkSlug): boolean => {
    const parkData = data?.parks.find(p => p.park === parkDisplayName(park));
    if (!parkData || 'error' in parkData) return false;
    return parkData.rides.some(r => r.status === 'OPERATING' && r.currentWait !== null);
  }, [data]);

  const runFetch = useCallback(async (lat: number, lng: number, park: ParkSlug) => {
    inFlightAbort.current?.abort();
    const controller = new AbortController();
    inFlightAbort.current = controller;

    if (!isParkOpen(park)) {
      setRecs(null);
      setRecsError(null);
      setRecsLoading(false);
      return;
    }

    setRecsLoading(true);
    setRecsError(null);
    setLoadMoreError(null);
    setExpandedRideId(null);
    loadMoreAbort.current?.abort();
    try {
      const res = await fetchRecommendations({ park, userLat: lat, userLng: lng, persona, signal: controller.signal });
      if (controller.signal.aborted) return;
      setRecs(res);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message = err instanceof ApiError ? err.message : 'Unknown error';
      setRecsError(message);
    } finally {
      if (!controller.signal.aborted) setRecsLoading(false);
    }
  }, [isParkOpen, persona]);

  const loadMore = useCallback(async () => {
    if (!recs || !coords) return;
    const park = derivePark(coords.lat, coords.lng, dailyContext?.parks);
    loadMoreAbort.current?.abort();
    const controller = new AbortController();
    loadMoreAbort.current = controller;

    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await fetchRecommendations({
        park,
        userLat: coords.lat,
        userLng: coords.lng,
        persona,
        excludeRideIds: recs.recommendations.map(r => r.rideId),
        signal: controller.signal,
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
  }, [recs, coords, dailyContext, persona]);

  // Stable key derived from coordinates — changes only when GPS resolves or
  // debug coords are set, not on every context re-render.
  const coordsKey = coords ? `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}` : null;

  // Fetch whenever we have a ready location, or when the persona changes.
  useEffect(() => {
    if (status !== 'ready' || !coords) return;
    const park = derivePark(coords.lat, coords.lng, dailyContext?.parks);
    void runFetch(coords.lat, coords.lng, park);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordsKey, status, persona, dailyContext?.parks]);

  const handleDebugPickerSubmit = useCallback((_park: ParkSlug, rideId: string) => {
    setDebugPickerOpen(false);
    const ride = ridesById.get(rideId);
    if (ride?.lat != null && ride?.lng != null) {
      setDebugCoords(ride.lat, ride.lng);
    }
  }, [ridesById, setDebugCoords]);

  // --- render ---

  if (waitsLoading && !data) {
    return (
      <SafeAreaView style={styles.center} testID="recs-loading-waits">
        <ActivityIndicator size="large" />
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  if (waitsError && !data) {
    return (
      <SafeAreaView style={styles.errorContainer} testID="recs-waits-error">
        <Text style={styles.errorTitle}>Couldn't load ride data</Text>
        <Text style={styles.errorBody}>{waitsError}</Text>
        <Text style={styles.errorHint}>
          We can't recommend rides until live ride data loads. Pull-to-refresh on the Browse tab to retry.
        </Text>
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  // GPS denied — no location access.
  if (!debugMode && status === 'denied') {
    return (
      <SafeAreaView style={styles.errorContainer} testID="recs-location-denied">
        <Text style={styles.errorTitle}>Location access denied</Text>
        <Text style={styles.errorBody}>
          Club 32 needs your location to recommend what to ride next.
        </Text>
        <Text style={styles.errorHint}>
          Enable location in your device settings and return to this tab.
        </Text>
        <Pressable style={styles.retryButton} onPress={retry} testID="recs-retry-location">
          <Text style={styles.retryButtonText}>Try again</Text>
        </Pressable>
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  // Outside park boundaries.
  if (!debugMode && status === 'out-of-park') {
    return (
      <SafeAreaView style={styles.errorContainer} testID="recs-out-of-park">
        <Text style={styles.errorTitle}>You don't appear to be in the park</Text>
        <Text style={styles.errorBody}>
          Recommendations are available once you're inside Disneyland or California Adventure.
        </Text>
        <Pressable style={styles.retryButton} onPress={retry} testID="recs-retry-location">
          <Text style={styles.retryButtonText}>Check again</Text>
        </Pressable>
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  // Debug mode: no coords yet → force picker open.
  const needsDebugPick = debugMode && !coords;
  const derivedPark = coords ? derivePark(coords.lat, coords.lng, dailyContext?.parks) : null;

  return (
    <SafeAreaView style={styles.container} testID="recs-loaded">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.titleRow}>
            <Text style={styles.headerTitle}>Recommendations</Text>
            {debugMode && <Text style={styles.debugBadge}>DEBUG</Text>}
          </View>
          {recs && !recsLoading ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              Near {recs.currentRide.name} · {parkDisplayName(recs.currentRide.park)}
            </Text>
          ) : null}
          {recs && !recsLoading ? (
            <Text style={styles.headerAsOf} testID="recs-as-of">
              as of {formatHHMM(recs.lastUpdated)}
            </Text>
          ) : null}
        </View>
        {debugMode && (
          <Pressable
            onPress={() => setDebugPickerOpen(true)}
            style={styles.changeButton}
            testID="recs-change-location"
          >
            <Text style={styles.changeButtonText}>Change location</Text>
          </Pressable>
        )}
      </View>

      {(status === 'idle' || status === 'locating') && !debugMode ? (
        <View style={styles.center} testID="recs-locating">
          <ActivityIndicator size="large" />
          <Text style={styles.loadingHint}>Locating you…</Text>
        </View>
      ) : derivedPark && !isParkOpen(derivedPark) ? (
        <View style={styles.errorContainer} testID="recs-park-closed">
          <Text style={styles.errorTitle}>{parkDisplayName(derivedPark)} is closed</Text>
          <Text style={styles.errorBody}>
            We don't recommend rides when the park isn't open — wait times aren't available yet.
          </Text>
          <Text style={styles.errorHint}>
            Check back after the park opens (typically 8 AM PT).
          </Text>
        </View>
      ) : recsLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingHint}>{loadingLine}</Text>
        </View>
      ) : recsError ? (
        <View style={styles.errorContainer} testID="recs-error">
          <Text style={styles.errorTitle}>Couldn't get recommendations</Text>
          <Text style={styles.errorBody}>{recsError}</Text>
          {coords && derivedPark ? (
            <Pressable
              style={styles.retryButton}
              onPress={() => void runFetch(coords.lat, coords.lng, derivedPark)}
              testID="recs-retry"
            >
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : recs ? (
        <RecsList
          recs={recs}
          ridesById={ridesById}
          expandedRideId={expandedRideId}
          loadingMore={loadingMore}
          loadMoreError={loadMoreError}
          onShowMore={() => void loadMore()}
          onToggleExpand={(rideId) =>
            setExpandedRideId(prev => (prev === rideId ? null : rideId))
          }
        />
      ) : null}

      {/* Debug picker — only shown in debug mode */}
      {debugMode && (
        <PickerSheet
          visible={debugPickerOpen || needsDebugPick}
          initialPark={derivedPark}
          initialRideId={null}
          ridesByPark={ridesByParkForPicker}
          restrictToParks={dailyContext?.parks ?? 'both'}
          onSubmit={handleDebugPickerSubmit}
          onClose={() => {
            if (coords) setDebugPickerOpen(false);
          }}
        />
      )}

      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function RecsList({
  recs,
  ridesById,
  expandedRideId,
  loadingMore,
  loadMoreError,
  onShowMore,
  onToggleExpand,
}: {
  recs: RecommendationsResponse;
  ridesById: Map<string, Ride>;
  expandedRideId: string | null;
  loadingMore: boolean;
  loadMoreError: string | null;
  onShowMore: () => void;
  onToggleExpand: (rideId: string) => void;
}): React.ReactElement {
  if (recs.recommendations.length === 0) {
    return (
      <View style={styles.emptyContainer} testID="recs-empty">
        <Text style={styles.emptyTitle}>No recommendations</Text>
        <Text style={styles.emptyBody}>
          The park doesn't have any operating rides available right now.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={recs.recommendations}
      keyExtractor={r => r.rideId}
      renderItem={({ item }) => (
        <RecommendationCard
          rec={item}
          ride={ridesById.get(item.rideId)}
          expanded={expandedRideId === item.rideId}
          onPress={() => onToggleExpand(item.rideId)}
        />
      )}
      ListHeaderComponent={
        recs.degraded ? (
          <View style={styles.degradedBanner} testID="recs-degraded">
            <Text style={styles.degradedText}>
              Recommendations are best-effort right now (AI layer unavailable).
            </Text>
          </View>
        ) : null
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.moreLoadingRow} testID="recs-loading-more">
            <ActivityIndicator size="small" />
            <Text style={styles.moreLoadingText}>Finding more picks…</Text>
          </View>
        ) : loadMoreError ? (
          <View style={styles.moreErrorRow}>
            <Text style={styles.moreErrorText}>{loadMoreError}</Text>
            <Pressable style={styles.moreButton} onPress={onShowMore} testID="recs-show-more-retry">
              <Text style={styles.moreButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : recs.hasMore ? (
          <Pressable style={styles.moreButton} onPress={onShowMore} testID="recs-show-more">
            <Text style={styles.moreButtonText}>Show more</Text>
          </Pressable>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
  },
  headerLeft: { flex: 1, paddingRight: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#222' },
  debugBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#f5a623',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  headerSubtitle: { fontSize: 12, color: '#666', marginTop: 2 },
  headerAsOf: { fontSize: 11, color: '#888', marginTop: 2, fontStyle: 'italic' },
  changeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f4f4f7',
  },
  changeButtonText: { color: '#444', fontSize: 13, fontWeight: '600' },
  loadingHint: { color: '#666', marginTop: 12, fontSize: 13 },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#c41e3a', marginBottom: 6 },
  errorBody: { fontSize: 14, color: '#444', textAlign: 'center' },
  errorHint: { fontSize: 12, color: '#888', marginTop: 12, textAlign: 'center' },
  retryButton: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#222',
  },
  retryButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyContainer: { padding: 32, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 6 },
  emptyBody: { fontSize: 13, color: '#666', textAlign: 'center' },
  degradedBanner: {
    backgroundColor: '#fff7e0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomColor: '#f1d77a',
    borderBottomWidth: 1,
  },
  degradedText: { fontSize: 12, color: '#7a5b00' },
  moreButton: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#6b6bf5',
    alignItems: 'center',
  },
  moreButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  moreLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 16,
    paddingVertical: 14,
    gap: 8,
  },
  moreLoadingText: { fontSize: 13, color: '#666' },
  moreErrorRow: { margin: 16, alignItems: 'center' },
  moreErrorText: { fontSize: 13, color: '#7a1f1f', marginBottom: 8, textAlign: 'center' },
});
