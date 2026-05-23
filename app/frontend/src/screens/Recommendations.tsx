// Recommendations landing screen.
//
// Launch flow (per v2 spec):
//   1. App mounts → RideProvider fires /v0/waits (the source of ride data
//      for both tabs).
//   2. This screen reads persisted selection from AsyncStorage.
//      - none           → open picker
//      - < 1 hour old   → skip picker, fetch /v2/recommendations using it
//      - ≥ 1 hour old   → open picker pre-filled
//   3. After picker submit: save selection, fire /v2/recommendations.
//   4. Show 5 cards + "More" button → reveals 5 more from the same payload.
//   5. Header "Change location" button always re-opens picker pre-filled.

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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError, fetchRecommendations } from '../api';
import { ParkSlug, Recommendation, RecommendationsResponse, Ride } from '../types';
import { useRides } from '../context/RideContext';
import {
  PersistedSelection,
  getLastSelection,
  isStale,
  setLastSelection,
} from '../utils/recommendationsStorage';
import { PickerSheet, parkDisplayName } from '../components/PickerSheet';
import { RecommendationCard } from '../components/RecommendationCard';
import type { RecommendationsStackParamList } from '../navigation/AppNavigator';

const PAGE_SIZE = 5;

type Props = NativeStackScreenProps<RecommendationsStackParamList, 'RecommendationsList'>;

export function Recommendations({ navigation }: Props): React.ReactElement {
  const {
    data,
    error: waitsError,
    loading: waitsLoading,
    ridesById,
  } = useRides();

  const [selection, setSelection] = useState<PersistedSelection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recs, setRecs] = useState<RecommendationsResponse | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const inFlightAbort = useRef<AbortController | null>(null);
  const [initialized, setInitialized] = useState(false);

  // 1. On mount, read persisted selection and decide whether to open the picker.
  useEffect(() => {
    (async () => {
      const saved = await getLastSelection();
      setSelection(saved);
      if (!saved) {
        setPickerOpen(true);
      } else if (isStale(saved)) {
        setPickerOpen(true);
      } else {
        // Fresh enough — auto-fetch with the saved selection.
        void runFetch(saved.park, saved.currentRideId);
      }
      setInitialized(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ridesByPark: derive from RideContext.data for the picker.
  const ridesByPark = useMemo<Record<ParkSlug, Ride[]>>(() => {
    const out: Record<ParkSlug, Ride[]> = {
      'disneyland': [],
      'california-adventure': [],
    };
    if (!data) return out;
    for (const slug of Object.keys(out) as ParkSlug[]) {
      const parkData = data.parks.find(p => p.park === parkDisplayName(slug));
      if (parkData && !('error' in parkData)) {
        out[slug] = parkData.rides;
      }
    }
    return out;
  }, [data]);

  const runFetch = useCallback(async (park: ParkSlug, currentRideId: string) => {
    // Cancel any prior in-flight call so a re-pick doesn't race the previous one.
    inFlightAbort.current?.abort();
    const controller = new AbortController();
    inFlightAbort.current = controller;

    setRecsLoading(true);
    setRecsError(null);
    setVisibleCount(PAGE_SIZE);
    try {
      const res = await fetchRecommendations({ park, currentRideId, signal: controller.signal });
      if (controller.signal.aborted) return;
      setRecs(res);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message = err instanceof ApiError ? err.message : 'Unknown error';
      setRecsError(message);
    } finally {
      if (!controller.signal.aborted) setRecsLoading(false);
    }
  }, []);

  const handlePickerSubmit = useCallback(async (park: ParkSlug, currentRideId: string) => {
    setPickerOpen(false);
    await setLastSelection(park, currentRideId);
    setSelection({ park, currentRideId, timestamp: Date.now() });
    void runFetch(park, currentRideId);
  }, [runFetch]);

  // Top-level branch ordering: error states first, then loading, then data.
  if (!initialized || waitsLoading && !data) {
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

  const currentRideName =
    selection ? ridesById.get(selection.currentRideId)?.name ?? selection.currentRideId : '—';

  return (
    <SafeAreaView style={styles.container} testID="recs-loaded">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Recommendations</Text>
          {selection ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              From {currentRideName} · {parkDisplayName(selection.park)}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={styles.changeButton}
          testID="recs-change-location"
        >
          <Text style={styles.changeButtonText}>Change location</Text>
        </Pressable>
      </View>

      {recsLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingHint}>Picking 10 rides for you…</Text>
        </View>
      ) : recsError ? (
        <View style={styles.errorContainer} testID="recs-error">
          <Text style={styles.errorTitle}>Couldn't get recommendations</Text>
          <Text style={styles.errorBody}>{recsError}</Text>
          {selection ? (
            <Pressable
              style={styles.retryButton}
              onPress={() => void runFetch(selection.park, selection.currentRideId)}
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
          visibleCount={visibleCount}
          onShowMore={() => setVisibleCount(c => c + PAGE_SIZE)}
          onPressRec={(rec) =>
            navigation.navigate('RecommendationDetail', {
              rideId: rec.rideId,
              oneLiner: rec.oneLiner,
              paragraph: rec.paragraph,
              walkMinutes: rec.walkMinutes,
            })
          }
        />
      ) : null}

      <PickerSheet
        visible={pickerOpen}
        initialPark={selection?.park ?? null}
        initialRideId={selection?.currentRideId ?? null}
        ridesByPark={ridesByPark}
        onSubmit={handlePickerSubmit}
        onClose={() => {
          // Only allow dismissing without picking if a selection already exists.
          if (selection) setPickerOpen(false);
        }}
      />

      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function RecsList({
  recs,
  ridesById,
  visibleCount,
  onShowMore,
  onPressRec,
}: {
  recs: RecommendationsResponse;
  ridesById: Map<string, Ride>;
  visibleCount: number;
  onShowMore: () => void;
  onPressRec: (rec: Recommendation) => void;
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

  const sliced = recs.recommendations.slice(0, visibleCount);
  const moreAvailable = recs.recommendations.length > visibleCount;

  return (
    <FlatList
      data={sliced}
      keyExtractor={r => r.rideId}
      renderItem={({ item }) => (
        <RecommendationCard
          rec={item}
          ride={ridesById.get(item.rideId)}
          onPress={() => onPressRec(item)}
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
        moreAvailable ? (
          <Pressable style={styles.moreButton} onPress={onShowMore} testID="recs-show-more">
            <Text style={styles.moreButtonText}>More recommendations</Text>
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
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLeft: { flex: 1, paddingRight: 12 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#222' },
  headerSubtitle: { fontSize: 12, color: '#666', marginTop: 2 },
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
});
