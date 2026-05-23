import React, { useCallback, useState } from 'react';
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
import {
  ListItem,
  flattenForList,
  rideWaitLabel,
} from '../grouping';
import { formatHHMM, olderLastUpdated } from '../timestamp';
import { TrendArrow } from '../components/TrendArrow';
import { BelowNormalBadge } from '../components/BelowNormalBadge';
import { RecommendationBadge } from '../components/RecommendationBadge';
import { DebugCard } from '../components/DebugCard';
import { TimeTravelModal } from '../components/TimeTravelModal';
import { isWalkOnRide } from '../utils/walkOn';
import { useRides } from '../context/RideContext';
import type { ScoreResult } from '../types';

const SUPPRESSED_SCORE: ScoreResult = {
  score: 0,
  badge: null,
  factors: {
    vsAvg: null,
    vsRange: null,
    projectedChange: null,
    nearTermChange: null,
  },
};

export function Home() {
  // Shared ride state lives in RideProvider; the Browse screen owns only
  // its own UI state (expanded debug rows + time-travel modal). The auto-
  // refresh and foreground-refresh effects moved to the provider too.
  const { data, error, loading, refreshing, lastRefreshedAt, refresh } = useRides();
  const [expandedRideId, setExpandedRideId] = useState<string | null>(null);
  const [timeTravelAt, setTimeTravelAt] = useState<string | null>(null);
  const [timeTravelLabel, setTimeTravelLabel] = useState<string | null>(null);
  const [showTimeTravelModal, setShowTimeTravelModal] = useState(false);

  const onRefresh = useCallback(() => {
    void refresh('user');
  }, [refresh]);

  const handleTimeTravelSet = useCallback((at: string, label: string) => {
    setTimeTravelAt(at);
    setTimeTravelLabel(label);
    setShowTimeTravelModal(false);
    void refresh('auto', at);
  }, [refresh]);

  const handleResume = useCallback(() => {
    setTimeTravelAt(null);
    setTimeTravelLabel(null);
    setShowTimeTravelModal(false);
    void refresh('user');
  }, [refresh]);

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
  // When the bucket0 sample count is low, the TrendArrow renders with a
  // dashed "low confidence" border. Production target is ~20, matching the
  // score and below-normal-badge gates. Currently set to 1 because data
  // collection started 2026-05-02 — every cell would otherwise render as
  // low-confidence on weekends. Raise back toward 20 with the other gates
  // once wait_times has several months of history.
  const lowConfidence = (bucket0?.sampleCount ?? 0) < 1;
  const scoreResult = ride.score ?? SUPPRESSED_SCORE;
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait);
  const isExpanded = expandedRideId === ride.id;

  return (
    <>
      <Pressable
        onPress={() => onToggleExpand(ride.id)}
        testID={`ride-${ride.id}`}
      >
        <View style={styles.rideRow}>
          {scoreResult.badge === 'star'
            ? <RecommendationBadge badge="star" />
            : walkOn
            ? <Text style={styles.walkOnEmoji} testID="badge-walk-on">🚶</Text>
            : <RecommendationBadge badge={scoreResult.badge} />
          }
          <Text style={styles.rideName} numberOfLines={1}>
            {ride.name}
          </Text>
          <View style={styles.rideRight}>
            <View style={styles.waitRow}>
              <Text style={styles.rideWait}>{rideWaitLabel(ride)}</Text>
              {showIndicators && bucket4 ? (
                <TrendArrow
                  bucket0Wait={ride.currentWait}
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
  walkOnEmoji: {
    width: 20,
    height: 20,
    marginRight: 8,
    fontSize: 14,
    textAlign: 'center',
  },
});
