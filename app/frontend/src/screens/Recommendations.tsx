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
  RefreshControl,
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
import { GradientHeader } from '../components/GradientHeader';
import { StateBlock } from '../components/StateBlock';
import { CircleAlert, Info, LocateFixed, MapPin, MapPinOff, MoonStar } from 'lucide-react-native';
import { formatHHMM } from '../timestamp';
import { haversineMeters } from '../grouping';
import { colors, spacing, typography } from '../theme/tokens';

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

  const onRefresh = useCallback(() => {
    if (!coords) return;
    const park = derivePark(coords.lat, coords.lng, dailyContext?.parks);
    void runFetch(coords.lat, coords.lng, park);
  }, [coords, dailyContext?.parks, runFetch]);

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
      <SafeAreaView style={styles.container} testID="recs-loading-waits">
        <StateBlock loading title="Club 32" body="Loading ride data…" />
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  if (waitsError && !data) {
    return (
      <SafeAreaView style={styles.container} testID="recs-waits-error">
        <StateBlock
          icon={<CircleAlert size={48} color={colors.textTertiary} />}
          title="Couldn't load ride data"
          body="We can't recommend rides until live data loads. Pull-to-refresh on the Browse tab to retry."
        />
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  if (!debugMode && status === 'denied') {
    return (
      <SafeAreaView style={styles.container} testID="recs-location-denied">
        <StateBlock
          icon={<MapPinOff size={48} color={colors.textTertiary} />}
          title="Location access needed"
          body="Club 32 uses your location to sort rides by how far you are. You can enable it in Settings."
          action={{ label: 'Try again', onPress: retry, testID: 'recs-retry-location' }}
        />
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  if (!debugMode && status === 'out-of-park') {
    return (
      <SafeAreaView style={styles.container} testID="recs-out-of-park">
        <StateBlock
          icon={<MapPin size={48} color={colors.textTertiary} />}
          title="You're outside the park"
          body="Recommendations are based on where you are in the park. Head in and we'll pick up from there."
          action={{ label: 'Check again', onPress: retry, testID: 'recs-retry-location' }}
        />
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  // Debug mode: no coords yet → force picker open.
  const needsDebugPick = debugMode && !coords;
  const derivedPark = coords ? derivePark(coords.lat, coords.lng, dailyContext?.parks) : null;

  return (
    <SafeAreaView style={styles.container} testID="recs-loaded">
      <GradientHeader
        title={debugMode ? 'Recommendations  DEBUG' : 'Recommendations'}
        subtitle={
          recs && !recsLoading
            ? `Near ${recs.currentRide.name} · ${parkDisplayName(recs.currentRide.park)}`
            : undefined
        }
        right={
          debugMode ? (
            <Pressable
              onPress={() => setDebugPickerOpen(true)}
              style={styles.changeButton}
              testID="recs-change-location"
            >
              <Text style={styles.changeButtonText}>Change</Text>
            </Pressable>
          ) : (
            <NotificationBellButton />
          )
        }
      />

      {(status === 'idle' || status === 'locating') && !debugMode ? (
        <StateBlock
          icon={<LocateFixed size={48} color={colors.brand} />}
          title="Finding your location"
          body="Hang on just a moment."
          testID="recs-locating"
        />
      ) : derivedPark && !isParkOpen(derivedPark) ? (
        <StateBlock
          icon={<MoonStar size={48} color={colors.textTertiary} />}
          title="The park is closed right now"
          body="Check back when the park opens. Predictions will be ready for you."
          testID="recs-park-closed"
        />
      ) : recsLoading ? (
        <StateBlock loading title={loadingLine} />
      ) : recsError ? (
        <StateBlock
          icon={<CircleAlert size={48} color={colors.textTertiary} />}
          title="Couldn't load recommendations"
          body="Something went wrong on our end. Try again."
          action={coords && derivedPark ? {
            label: 'Try again',
            onPress: () => void runFetch(coords.lat, coords.lng, derivedPark),
            testID: 'recs-retry',
          } : undefined}
          testID="recs-error"
        />
      ) : recs ? (
        <RecsList
          recs={recs}
          ridesById={ridesById}
          loadingMore={loadingMore}
          loadMoreError={loadMoreError}
          onShowMore={() => void loadMore()}
          refreshing={recsLoading}
          onRefresh={onRefresh}
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
  loadingMore,
  loadMoreError,
  onShowMore,
  refreshing,
  onRefresh,
}: {
  recs: RecommendationsResponse;
  ridesById: Map<string, Ride>;
  loadingMore: boolean;
  loadMoreError: string | null;
  onShowMore: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  if (recs.recommendations.length === 0) {
    return (
      <StateBlock
        icon={<CircleAlert size={48} color={colors.textTertiary} />}
        title="No recommendations"
        body="The park doesn't have any operating rides available right now."
        testID="recs-empty"
      />
    );
  }

  return (
    <FlatList
      data={recs.recommendations}
      keyExtractor={r => r.rideId}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      renderItem={({ item }) => (
        <RecommendationCard
          rec={item}
          ride={ridesById.get(item.rideId)}
        />
      )}
      ListHeaderComponent={
        recs.degraded ? (
          <View style={styles.degradedBanner} testID="recs-degraded">
            <Info size={14} color={colors.star} />
            <Text style={styles.degradedText}>Recommendations are best-effort right now</Text>
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
            <Text style={styles.moreErrorBody}>{loadMoreError}</Text>
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
  container: { flex: 1, backgroundColor: colors.surface },
  listContent: { paddingTop: spacing.sm },
  changeButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  changeButtonText: { color: colors.textInverse, fontSize: 13, fontWeight: '600' },
  degradedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.starBg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: colors.star,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  degradedText: { ...typography.caption, color: colors.textSecondary },
  moreButton: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.brand,
    alignItems: 'center',
  },
  moreButtonText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  moreLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 16,
    paddingVertical: 14,
    gap: 8,
  },
  moreLoadingText: { ...typography.caption, color: colors.textSecondary },
  moreErrorRow: { margin: 16, alignItems: 'center' },
  moreErrorBody: { ...typography.caption, color: colors.skip, marginBottom: 8, textAlign: 'center' },
});
