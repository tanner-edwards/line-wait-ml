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
import { Clock } from 'lucide-react-native';
import { StateBlock } from '../components/StateBlock';
import { colors } from '../theme/tokens';
import { StatusBar } from 'expo-status-bar';
import {
  ListItem,
  SortBy,
  flattenForList,
  flattenSorted,
} from '../grouping';
import { formatHHMM, olderLastUpdated } from '../timestamp';
import { TimeTravelModal } from '../components/TimeTravelModal';
import { SortMenu } from '../components/SortMenu';
import { NotificationBellButton } from '../components/NotificationBellButton';
import { GradientHeader, gradientHeaderTextStyles } from '../components/GradientHeader';
import { RideRow } from '../components/RideRow';
import { ArrowUpDown } from 'lucide-react-native';
import { useRides } from '../context/RideContext';
import { useLocation } from '../context/LocationContext';
import { useDailyContext } from '../context/DailyContextContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { filterByDailyParks } from '../utils/parkFilter';


export function Home() {
  // Shared ride state lives in RideProvider; the Browse screen owns only
  // its own UI state (expanded debug rows + time-travel modal). The auto-
  // refresh and foreground-refresh effects moved to the provider too.
  const { data, error, loading, refreshing, lastRefreshedAt, refresh } = useRides();
  const { coords: locationCoords, status: locationStatus } = useLocation();
  const { context: dailyContext } = useDailyContext();

  const [timeTravelAt, setTimeTravelAt] = useState<string | null>(null);
  const [timeTravelLabel, setTimeTravelLabel] = useState<string | null>(null);
  const [showTimeTravelModal, setShowTimeTravelModal] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy | null>('opportunity');
  const [showSortMenu, setShowSortMenu] = useState(false);

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
      <SafeAreaView style={styles.container} testID="home-loading">
        <StateBlock
          loading
          title="Club 32"
          body="Loading ride data…"
        />
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  const walkOrigin = (sortBy === 'distance' || sortBy === 'opportunity') ? locationCoords : null;

  // Apply daily-park filter before flattening so the list (and any sort)
  // only sees rides in the selected park scope.
  const scopedData = data && dailyContext
    ? filterByDailyParks(data, dailyContext.parks)
    : data;

  const items: ListItem[] = scopedData
    ? sortBy
      ? flattenSorted(scopedData, sortBy, locationCoords)
      : flattenForList(scopedData)
    : [];
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
      <GradientHeader
        title="Live Waits"
        subtitle={
          <Pressable onPress={() => setShowTimeTravelModal(true)} testID="time-travel-trigger">
            <Text
              style={timeTravelAt ? gradientHeaderTextStyles.subtitleActive : gradientHeaderTextStyles.subtitle}
              testID="last-update"
            >
              {timeTravelAt ? `Time set to: ${timeTravelLabel}` : `Last update: ${lastUpdate}`}
            </Text>
          </Pressable>
        }
        right={
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowSortMenu(true)}
              testID="sort-button"
              style={styles.sortButton}
            >
              <ArrowUpDown size={20} color={sortBy ? colors.textInverse : 'rgba(255,255,255,0.65)'} />
            </Pressable>
            <NotificationBellButton />
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
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.refreshButtonText}>Refresh</Text>
              )}
            </Pressable>
          </>
        }
      />
      <FlatList
        data={items}
        keyExtractor={item => item.key}
        renderItem={({ item }) => (
          <ListRow item={item} walkOrigin={walkOrigin} />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          !hasAnyData ? (
            <StateBlock
              icon={<Clock size={48} color={colors.textTertiary} />}
              title="No wait times yet"
              body="Data should appear once the park opens and rides start posting wait times."
              testID="empty-state"
            />
          ) : null
        }
        contentContainerStyle={items.length === 0 ? styles.emptyListContent : undefined}
      />
      <SortMenu
        visible={showSortMenu}
        current={sortBy}
        distanceAvailable={locationCoords !== null && locationStatus === 'ready'}
        onSelect={setSortBy}
        onClose={() => setShowSortMenu(false)}
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
  walkOrigin,
}: {
  item: ListItem;
  walkOrigin: { lat: number; lng: number } | null;
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
  return <RideRow ride={item.ride} walkOrigin={walkOrigin} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  emptyListContent: { flexGrow: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff', // TODO: tokenize
  },
  errorBanner: {
    backgroundColor: colors.skipBg,
    padding: 12,
    borderBottomColor: colors.skip,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  errorBannerText: { color: colors.skip, fontSize: 14 },
  toggleRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomColor: '#eee', // TODO: tokenize
    borderBottomWidth: 1,
  },
  sortButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 4,
  },
  refreshButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonDisabled: { opacity: 0.5 },
  refreshButtonPressed: { opacity: 0.7 },
  refreshButtonText: { color: colors.textInverse, fontSize: 14, fontWeight: '600' },
  parkHeader: {
    backgroundColor: '#f4f4f7', // TODO: tokenize
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  parkHeaderErrored: { backgroundColor: '#fde2e2' }, // TODO: tokenize
  parkHeaderText: { fontSize: 18, fontWeight: '700' },
  parkHeaderErrText: { fontSize: 12, color: '#7a1f1f', marginTop: 2 }, // TODO: tokenize
  landHeader: {
    paddingHorizontal: 24,
    paddingVertical: 6,
    backgroundColor: '#fafafa', // TODO: tokenize
  },
  landHeaderText: { fontSize: 14, fontWeight: '600', color: '#444' }, // TODO: tokenize
});
