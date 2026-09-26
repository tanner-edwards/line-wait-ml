// Recommendations screen — v4.
//
// Location flow:
//   GPS ready        → auto-fetch with user coordinates; backend derives nearest ride
//   Needs permission → priming screen; its button triggers the OS dialog
//   GPS denied       → iOS won't prompt again, so Settings is the only way back
//   GPS error        → permission is fine, no fix yet → Retry
//   Out of park      → "You don't appear to be in the park" + Retry
//   Debug mode       → ride picker (OPERATING rides only) injects fake GPS coords

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { ApiError, fetchRecommendations } from '../api';
import { DailyContext, ParkSlug, Persona, RecommendationsResponse, Ride } from '../types';
import { useRides } from '../context/RideContext';
import { useAuth } from '../context/AuthContext';
import { useDevice } from '../context/DeviceContext';
import { usePersona } from '../context/PersonaContext';
import { useDailyContext } from '../context/DailyContextContext';
import { useLocation } from '../context/LocationContext';
import { useDebugMode } from '../context/DebugModeContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { PickerSheet, parkDisplayName } from '../components/PickerSheet';
import { RecommendationCard } from '../components/RecommendationCard';
import { UndoToast } from '../components/UndoToast';
import { NotificationBellButton } from '../components/NotificationBellButton';
import { GradientHeader } from '../components/GradientHeader';
import { StateBlock } from '../components/StateBlock';
import { CircleAlert, Info, LocateFixed, LocateOff, MapPin, MapPinOff, MoonStar } from 'lucide-react-native';
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

// Recommendations calls a paid LLM endpoint, so re-fetching is gated behind
// this unified check rather than firing on every render/focus. Re-fetch only
// when the tab is focused AND at least one of these has changed since the
// last fetch: GPS moved 100m+, 5+ minutes elapsed, persona changed, or the
// daily park scope changed. The API call itself is debounced 1s behind the
// decision (with an immediate loading state) so a quick accidental tap on
// the tab doesn't burn a request.
const GPS_CHANGE_THRESHOLD_M = 100;
const STALE_MS = 5 * 60 * 1000;
const FETCH_DEBOUNCE_MS = 1000;

function derivePark(lat: number, lng: number, dailyParks: DailyContext['parks'] | undefined): ParkSlug {
  if (dailyParks === 'disneyland') return 'disneyland';
  if (dailyParks === 'california-adventure') return 'california-adventure';
  const dlr = haversineMeters(lat, lng, DLR_CENTER.lat, DLR_CENTER.lng);
  const dca = haversineMeters(lat, lng, DCA_CENTER.lat, DCA_CENTER.lng);
  return dlr <= dca ? 'disneyland' : 'california-adventure';
}

export function Recommendations(): React.ReactElement {
  const { data, error: waitsError, loading: waitsLoading, ridesById } = useRides();
  const { getIdToken } = useAuth();
  const { retiredRideIds, retireRide, unretireRide } = useDevice();
  const { persona } = usePersona();
  const { context: dailyContext } = useDailyContext();
  const { coords, status, requestPermission, retry, setDebugCoords, clearDebugCoords } = useLocation();
  const { debugMode } = useDebugMode();
  const { openDetail } = useNotificationDetail();

  const [recs, setRecs] = useState<RecommendationsResponse | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [debugPickerOpen, setDebugPickerOpen] = useState(false);
  const [debugPickerDismissed, setDebugPickerDismissed] = useState(false);
  const [undoToast, setUndoToast] = useState<{ rideId: string; key: number } | null>(null);

  const inFlightAbort = useRef<AbortController | null>(null);
  const loadMoreAbort = useRef<AbortController | null>(null);

  // Baseline for the focus-triggered refetch check — set the moment runFetch
  // actually commits to a network call (any trigger: auto, retry, pull-to-
  // refresh), not on every render.
  const lastFetchCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastFetchAtRef = useRef<number | null>(null);
  const lastFetchPersonaRef = useRef<Persona | null>(null);
  const lastFetchParkScopeRef = useRef<DailyContext['parks'] | undefined>(undefined);

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

    lastFetchCoordsRef.current = { lat, lng };
    lastFetchAtRef.current = Date.now();
    lastFetchPersonaRef.current = persona;
    lastFetchParkScopeRef.current = dailyContext?.parks;

    setRecsLoading(true);
    setRecsError(null);
    setLoadMoreError(null);
    loadMoreAbort.current?.abort();
    try {
      const idToken = await getIdToken();
      const res = await fetchRecommendations({
        park,
        userLat: lat,
        userLng: lng,
        persona,
        excludeRideIds: retiredRideIds,
        signal: controller.signal,
        idToken,
      });
      if (controller.signal.aborted) return;
      setRecs(res);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // 402 = not entitled. The tab paywall handles the upsell UI; here we just
      // avoid surfacing a scary error if an unentitled request slips through.
      if (err instanceof ApiError && err.statusCode === 402) {
        setRecs(null);
        setRecsError(null);
        return;
      }
      const message = err instanceof ApiError ? err.message : 'Unknown error';
      setRecsError(message);
    } finally {
      if (!controller.signal.aborted) setRecsLoading(false);
    }
  }, [isParkOpen, persona, dailyContext?.parks, getIdToken, retiredRideIds]);

  const loadMore = useCallback(async () => {
    if (!recs || !coords) return;
    const park = derivePark(coords.lat, coords.lng, dailyContext?.parks);
    loadMoreAbort.current?.abort();
    const controller = new AbortController();
    loadMoreAbort.current = controller;

    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const idToken = await getIdToken();
      const res = await fetchRecommendations({
        park,
        userLat: coords.lat,
        userLng: coords.lng,
        persona,
        excludeRideIds: [...recs.recommendations.map(r => r.rideId), ...retiredRideIds],
        signal: controller.signal,
        idToken,
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
  }, [recs, coords, dailyContext, persona, getIdToken, retiredRideIds]);

  const onRefresh = useCallback(() => {
    if (!coords) return;
    const park = derivePark(coords.lat, coords.lng, dailyContext?.parks);
    void runFetch(coords.lat, coords.lng, park);
  }, [coords, dailyContext?.parks, runFetch]);

  // Stable key derived from coordinates — changes only when GPS resolves or
  // debug coords are set, not on every context re-render.
  const coordsKey = coords ? `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}` : null;

  // Re-check on every focus of this tab (and whenever these deps change while
  // it stays focused): fetch only if GPS moved 100m+, 5+ min elapsed, persona
  // changed, or park scope changed since the last fetch. Loading shows
  // immediately so the tab doesn't feel unresponsive; the actual (costly) API
  // call is debounced 1s so a quick accidental tap doesn't spend a request.
  //
  // TODO: needs test coverage (focus/re-focus, each of the four trigger
  // conditions individually, debounce-cancel-on-blur-before-1s, and that
  // staying under all four thresholds does NOT re-fetch). Not added yet —
  // this screen has no existing test scaffolding, and exercising it properly
  // needs a NavigationContainer (to drive real focus/blur transitions) plus
  // Jest fake timers (for the 1s debounce), on top of the existing
  // useLocation/useRides/usePersona/useDailyContext/useAuth mocks. That setup
  // cost is more than fits inside this change; flagging rather than skipping
  // silently.
  useFocusEffect(
    useCallback(() => {
      if (status !== 'ready' || !coords) return;
      const park = derivePark(coords.lat, coords.lng, dailyContext?.parks);
      if (!isParkOpen(park)) return;

      const now = Date.now();
      const gpsChanged = !lastFetchCoordsRef.current
        || haversineMeters(
          coords.lat, coords.lng,
          lastFetchCoordsRef.current.lat, lastFetchCoordsRef.current.lng
        ) >= GPS_CHANGE_THRESHOLD_M;
      const timeStale = lastFetchAtRef.current === null || (now - lastFetchAtRef.current) >= STALE_MS;
      const personaChanged = persona !== lastFetchPersonaRef.current;
      const parkScopeChanged = dailyContext?.parks !== lastFetchParkScopeRef.current;

      if (!gpsChanged && !timeStale && !personaChanged && !parkScopeChanged) return;

      setRecsLoading(true);
      let fired = false;
      const timer = setTimeout(() => {
        fired = true;
        void runFetch(coords.lat, coords.lng, park);
      }, FETCH_DEBOUNCE_MS);

      return () => {
        clearTimeout(timer);
        if (!fired) setRecsLoading(false);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [coordsKey, status, persona, dailyContext?.parks, isParkOpen, runFetch])
  );

  const handleRetire = useCallback((rideId: string) => {
    retireRide(rideId);
    setUndoToast({ rideId, key: Date.now() });
  }, [retireRide]);

  const handleUndoRetire = useCallback(() => {
    if (undoToast) unretireRide(undoToast.rideId);
    setUndoToast(null);
  }, [undoToast, unretireRide]);

  const handleDismissToast = useCallback(() => setUndoToast(null), []);

  const handleDebugPickerSubmit = useCallback((_park: ParkSlug, rideId: string) => {
    setDebugPickerOpen(false);
    const ride = ridesById.get(rideId);
    if (ride?.lat != null && ride?.lng != null) {
      setDebugCoords(ride.lat, ride.lng);
    }
  }, [ridesById, setDebugCoords]);

  const handleResetGPS = useCallback(() => {
    setDebugPickerOpen(false);
    clearDebugCoords();
  }, [clearDebugCoords]);

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

  // Never asked yet (or iOS will still prompt): explain first, then let the
  // button fire the OS dialog. Must never shortcut to Settings from here.
  if (!debugMode && status === 'needs-permission') {
    return (
      <SafeAreaView style={styles.container} testID="recs-location-permission">
        <StateBlock
          icon={<MapPin size={48} color={colors.brand} />}
          title="Find rides near you"
          body="Club 32 uses your location to sort rides by how far you are and estimate walk times."
          action={{ label: 'Enable location', onPress: requestPermission, testID: 'recs-enable-location' }}
        />
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  // Declined and iOS won't prompt again — Settings genuinely is the only path.
  if (!debugMode && status === 'denied') {
    return (
      <SafeAreaView style={styles.container} testID="recs-location-denied">
        <StateBlock
          icon={<MapPinOff size={48} color={colors.textTertiary} />}
          title="Location access needed"
          body="Club 32 uses your location to sort rides by how far you are. Turn it on in Settings, then come back."
          action={{ label: 'Open Settings', onPress: () => void Linking.openSettings(), testID: 'recs-open-settings' }}
        />
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  // Permission is fine — the device just hasn't produced a fix.
  if (!debugMode && status === 'gps-error') {
    return (
      <SafeAreaView style={styles.container} testID="recs-location-error">
        <StateBlock
          icon={<LocateOff size={48} color={colors.textTertiary} />}
          title="Can't find your location"
          body="We couldn't get a GPS fix. Check that Location Services is on, then try again."
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
          action={{ label: 'Check again', onPress: retry, testID: 'recs-recheck-location' }}
        />
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  // Debug mode: no coords yet → force picker open.
  const needsDebugPick = debugMode && !coords && !debugPickerDismissed;
  const derivedPark = coords ? derivePark(coords.lat, coords.lng, dailyContext?.parks) : null;

  return (
    <SafeAreaView style={styles.container} testID="recs-loaded">
      <GradientHeader
        title="Recommendations"
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
          retiredRideIds={retiredRideIds}
          loadingMore={loadingMore}
          loadMoreError={loadMoreError}
          onShowMore={() => void loadMore()}
          refreshing={recsLoading}
          onRefresh={onRefresh}
          debugMode={debugMode}
          onCardPress={(rec) =>
            openDetail({
              rideId: rec.rideId,
              type: null,
              source: 'browse',
              restrictionNote: rec.restrictionNote,
              oneLiner: rec.oneLiner ?? null,
            })
          }
          onRetire={handleRetire}
        />
      ) : null}

      {undoToast ? (
        <UndoToast
          key={undoToast.key}
          message="Removed from list · Undo"
          onUndo={handleUndoRetire}
          onDismiss={handleDismissToast}
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
          onResetGPS={handleResetGPS}
          onClose={() => {
            setDebugPickerOpen(false);
            setDebugPickerDismissed(true);
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
  retiredRideIds,
  loadingMore,
  loadMoreError,
  onShowMore,
  refreshing,
  onRefresh,
  debugMode,
  onCardPress,
  onRetire,
}: {
  recs: RecommendationsResponse;
  ridesById: Map<string, Ride>;
  retiredRideIds: string[];
  loadingMore: boolean;
  loadMoreError: string | null;
  onShowMore: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  debugMode: boolean;
  onCardPress: (rec: RecommendationsResponse['recommendations'][number]) => void;
  onRetire: (rideId: string) => void;
}): React.ReactElement {
  // Defensive filter — the request-level excludeRideIds already keeps
  // retired rides out of fresh fetches, but this also drops one instantly
  // from a cached response without waiting on the next fetch.
  const visibleRecs = recs.recommendations.filter(r => !retiredRideIds.includes(r.rideId));

  if (visibleRecs.length === 0) {
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
      data={visibleRecs}
      keyExtractor={r => r.rideId}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      renderItem={({ item, index }) => (
        <RecommendationCard
          rec={item}
          ride={ridesById.get(item.rideId)}
          debugMode={debugMode}
          onPress={() => onCardPress(item)}
          onRetire={() => onRetire(item.rideId)}
          isFirst={index === 0}
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
  container: { flex: 1, backgroundColor: colors.bg },
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
