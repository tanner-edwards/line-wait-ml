import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ApiError, fetchWaits } from '../api';
import { CombinedResponse } from '../types';
import {
  ListItem,
  erroredParks,
  flattenForList,
  rideWaitLabel,
} from '../grouping';
import { formatHHMM, olderLastUpdated } from '../timestamp';
import { TrendArrow } from '../components/TrendArrow';
import { BelowNormalBadge } from '../components/BelowNormalBadge';
import { RecommendationBadge } from '../components/RecommendationBadge';
import { DebugCard } from '../components/DebugCard';
import { TimeTravelModal } from '../components/TimeTravelModal';
import { scoreRide } from '../utils/score';

export function Home() {
  const [data, setData] = useState<CombinedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [expandedRideId, setExpandedRideId] = useState<string | null>(null);
  const [timeTravelAt, setTimeTravelAt] = useState<string | null>(null);
  const [timeTravelLabel, setTimeTravelLabel] = useState<string | null>(null);
  const [showTimeTravelModal, setShowTimeTravelModal] = useState(false);
  const lastFetchedAtMs = useRef<number>(0);

  const load = useCallback(async (mode: 'initial' | 'user' | 'auto', at?: string) => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'user') setRefreshing(true);
    const fetchedAt = new Date().toISOString();
    try {
      const fresh = await fetchWaits(at);
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
      // Keep `data` and `lastRefreshedAt` as-is — failed fetch doesn't update the timestamp.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  // Auto-refresh every 10 minutes while the app is open.
  useEffect(() => {
    const id = setInterval(() => void load('auto'), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  // Auto-refresh when foregrounded after > 10 minutes of inactivity.
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        const staleMs = Date.now() - lastFetchedAtMs.current;
        if (staleMs > 10 * 60 * 1000) void load('auto');
      }
    });
    return () => sub.remove();
  }, [load]);

  const onRefresh = useCallback(() => {
    void load('user');
  }, [load]);

  const handleTimeTravelSet = useCallback((at: string, label: string) => {
    setTimeTravelAt(at);
    setTimeTravelLabel(label);
    setShowTimeTravelModal(false);
    void load('auto', at);
  }, [load]);

  const handleResume = useCallback(() => {
    setTimeTravelAt(null);
    setTimeTravelLabel(null);
    setShowTimeTravelModal(false);
    void load('user');
  }, [load]);

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center} testID="home-loading">
        <ActivityIndicator size="large" />
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  const items: ListItem[] = data ? flattenForList(data) : [];
  const lastUpdate = lastRefreshedAt
    ? formatHHMM(lastRefreshedAt)
    : data
    ? formatHHMM(olderLastUpdated(data))
    : '—';
  const hasAnyData = !!data && data.parks.some(p => !('error' in p));

  return (
    <SafeAreaView style={styles.container} testID="home-loaded">
      {error && (
        <View style={styles.errorBanner} testID="error-banner">
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Live Waits</Text>
          <Pressable onPress={() => setShowTimeTravelModal(true)} testID="time-travel-trigger">
            <Text
              style={[styles.headerSubtitle, timeTravelAt ? styles.headerSubtitleTimeTravel : null]}
              testID="last-update"
            >
              {timeTravelAt ? `Time set to: ${timeTravelLabel}` : `Last update: ${lastUpdate}`}
            </Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onRefresh}
          disabled={refreshing}
          testID="refresh-button"
          style={({ pressed }) => [
            styles.refreshButton,
            refreshing && styles.refreshButtonDisabled,
            pressed && styles.refreshButtonPressed,
          ]}
        >
          {refreshing ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text style={styles.refreshButtonText}>Refresh</Text>
          )}
        </Pressable>
      </View>
      <FlatList
        data={items}
        keyExtractor={item => item.key}
        renderItem={({ item }) => (
          <ListRow
            item={item}
            expandedRideId={expandedRideId}
            onToggleExpand={id =>
              setExpandedRideId(prev => (prev === id ? null : id))
            }
          />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          !hasAnyData ? (
            <View style={styles.empty} testID="empty-state">
              <Text style={styles.emptyText}>
                No wait time data available yet. Pull down to retry.
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={items.length === 0 ? styles.emptyContent : undefined}
      />
      <TimeTravelModal
        visible={showTimeTravelModal}
        onSet={handleTimeTravelSet}
        onResume={handleResume}
      />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function ListRow({
  item,
  expandedRideId,
  onToggleExpand,
}: {
  item: ListItem;
  expandedRideId: string | null;
  onToggleExpand: (id: string) => void;
}) {
  if (item.kind === 'park-header') {
    return (
      <View
        style={[styles.parkHeader, item.errored && styles.parkHeaderErrored]}
        testID={`park-${item.park}`}
      >
        <Text style={styles.parkHeaderText}>{item.park}</Text>
        {item.errored && (
          <Text style={styles.parkHeaderErrText}>data unavailable</Text>
        )}
      </View>
    );
  }
  if (item.kind === 'land-header') {
    return (
      <View style={styles.landHeader} testID={`land-${item.land}`}>
        <Text style={styles.landHeaderText}>{item.land}</Text>
      </View>
    );
  }
  const ride = item.ride;
  const isOperating = ride.status === 'OPERATING';
  const ha = ride.historicalAverage;
  const showIndicators = isOperating && ha !== null;
  const bucket0 = showIndicators && ha ? ha.buckets[0] : null;
  const bucket4 = showIndicators && ha ? ha.buckets[4] : null;
  const lowConfidence = (bucket0?.sampleCount ?? 0) < 20;
  const scoreResult = scoreRide(ride);
  const isExpanded = expandedRideId === ride.id;

  return (
    <>
      <Pressable
        onPress={() => onToggleExpand(ride.id)}
        testID={`ride-${ride.id}`}
      >
        <View style={styles.rideRow}>
          <RecommendationBadge badge={scoreResult.badge} />
          <Text style={styles.rideName} numberOfLines={1}>
            {ride.name}
          </Text>
          <View style={styles.rideRight}>
            <View style={styles.waitRow}>
              <Text style={styles.rideWait}>{rideWaitLabel(ride)}</Text>
              {showIndicators && bucket0 && bucket4 ? (
                <TrendArrow
                  bucket0Wait={bucket0.wait}
                  bucket2Wait={bucket4.wait}
                  lowConfidence={lowConfidence}
                />
              ) : null}
            </View>
            {showIndicators && bucket0 ? (
              <BelowNormalBadge
                currentWait={ride.currentWait}
                bucket0Wait={bucket0.wait}
                sampleCount={bucket0.sampleCount}
              />
            ) : null}
          </View>
        </View>
      </Pressable>
      {isExpanded && <DebugCard ride={ride} result={scoreResult} />}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  errorBanner: {
    backgroundColor: '#fde2e2',
    padding: 12,
    borderBottomColor: '#f5b5b5',
    borderBottomWidth: 1,
  },
  errorBannerText: { color: '#7a1f1f', fontSize: 14 },
  header: {
    padding: 16,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flex: 1 },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  headerSubtitle: { fontSize: 13, color: '#666', marginTop: 2 },
  headerSubtitleTimeTravel: { color: '#6b6bf5' },
  refreshButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#222',
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonDisabled: { backgroundColor: '#999' },
  refreshButtonPressed: { opacity: 0.7 },
  refreshButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  parkHeader: {
    backgroundColor: '#f4f4f7',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  parkHeaderErrored: { backgroundColor: '#fde2e2' },
  parkHeaderText: { fontSize: 18, fontWeight: '700' },
  parkHeaderErrText: { fontSize: 12, color: '#7a1f1f', marginTop: 2 },
  landHeader: {
    paddingHorizontal: 24,
    paddingVertical: 6,
    backgroundColor: '#fafafa',
  },
  landHeaderText: { fontSize: 14, fontWeight: '600', color: '#444' },
  rideRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
  },
  rideName: { flex: 1, fontSize: 15, marginRight: 12 },
  rideRight: {
    alignItems: 'flex-end',
  },
  waitRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rideWait: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    color: '#222',
    minWidth: 64,
    textAlign: 'right',
  },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#666', textAlign: 'center', fontSize: 14 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
});
