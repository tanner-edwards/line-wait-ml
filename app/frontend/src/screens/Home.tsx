import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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

export function Home() {
  const [data, setData] = useState<CombinedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh: boolean) => {
    if (!isRefresh) setLoading(true);
    try {
      const fresh = await fetchWaits();
      setData(fresh);
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
      // Keep `data` as-is on refresh failure (last good data stays visible).
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
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
  const lastUpdate = data ? formatHHMM(olderLastUpdated(data)) : '—';
  const hasAnyData = !!data && data.parks.some(p => !('error' in p));

  return (
    <SafeAreaView style={styles.container} testID="home-loaded">
      {error && (
        <View style={styles.errorBanner} testID="error-banner">
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Live Waits</Text>
        <Text style={styles.headerSubtitle} testID="last-update">
          Last update: {lastUpdate}
        </Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={item => item.key}
        renderItem={({ item }) => <ListRow item={item} />}
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
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function ListRow({ item }: { item: ListItem }) {
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
  return (
    <View style={styles.rideRow} testID={`ride-${item.ride.id}`}>
      <Text style={styles.rideName} numberOfLines={1}>
        {item.ride.name}
      </Text>
      <Text style={styles.rideWait}>{rideWaitLabel(item.ride)}</Text>
    </View>
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
  },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  headerSubtitle: { fontSize: 13, color: '#666', marginTop: 2 },
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
