import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Bookmark, Clock, LocateFixed, LocateOff, MapPin, MapPinOff, SearchX } from 'lucide-react-native';
import { StateBlock } from '../components/StateBlock';
import { colors, radius } from '../theme/tokens';
import {
  ListItem,
  SortBy,
  filterItemsByQuery,
  flattenForList,
  flattenSorted,
  nearbyRideIds,
  successfulParks,
} from '../grouping';
import { formatHHMM, olderLastUpdated } from '../timestamp';
import { TimeTravelModal } from '../components/TimeTravelModal';
import { SortMenu } from '../components/SortMenu';
import { NotificationBellButton } from '../components/NotificationBellButton';
import { GradientHeader, gradientHeaderTextStyles } from '../components/GradientHeader';
import { RideRow } from '../components/RideRow';
import { SearchField } from '../components/SearchField';
import { DiscoverChip, DiscoverChips } from '../components/DiscoverChips';
import { LandOption, LandPickerSheet } from '../components/LandPickerSheet';
import { ArrowUpDown } from 'lucide-react-native';
import { useRides } from '../context/RideContext';
import { useLocation } from '../context/LocationContext';
import { useDailyContext } from '../context/DailyContextContext';
import { useDebugMode } from '../context/DebugModeContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { usePersona } from '../context/PersonaContext';
import { filterByDailyParks } from '../utils/parkFilter';
import { CombinedResponse, Persona, Ride } from '../types';

// Keeps rides matching `keep`; drops park headers left with no rides. Errored
// park headers always stay — they carry the "data unavailable" notice.
function filterRides(items: ListItem[], keep: (ride: Ride) => boolean): ListItem[] {
  const kept = items.filter(item => item.kind !== 'ride' || keep(item.ride));
  return kept.filter((item, i) =>
    item.kind !== 'park-header' || item.errored || kept[i + 1]?.kind === 'ride'
  );
}

export function Home() {
  // Shared ride state lives in RideProvider; the Browse screen owns only
  // its own UI state (expanded debug rows + time-travel modal). The auto-
  // refresh and foreground-refresh effects moved to the provider too.
  const { data, error, loading, refreshing, lastRefreshedAt, refresh, timeTravelAt, setTimeTravelAt } = useRides();
  const { coords: locationCoords, status: locationStatus, requestPermission, retry } = useLocation();
  const { context: dailyContext } = useDailyContext();
  const { openDetail } = useNotificationDetail();
  const { persona } = usePersona();
  const { debugMode } = useDebugMode();

  // Build once per render; rows look up via Set.has() for O(1) per-row.
  const mustDoSet = React.useMemo(
    () => new Set(persona?.mustDoRideIds ?? []),
    [persona]
  );

  const [timeTravelLabel, setTimeTravelLabel] = useState<string | null>(null);
  const [showTimeTravelModal, setShowTimeTravelModal] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy | null>('opportunity');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // A chip and a sort-menu choice are mutually exclusive: while a chip is
  // active, `sortBy` is ignored and the sort menu shows nothing checked.
  const [chip, setChip] = useState<DiscoverChip | null>('nearby');
  const [selectedLand, setSelectedLand] = useState<string | null>(null);
  const [showLandPicker, setShowLandPicker] = useState(false);

  const handleSortSelect = useCallback((next: SortBy | null) => {
    setSortBy(next);
    setChip(null);
  }, []);

  const onRefresh = useCallback(() => {
    void refresh('user', undefined, true);
  }, [refresh]);

  const handleTimeTravelSet = useCallback((at: string, label: string) => {
    setTimeTravelAt(at);
    setTimeTravelLabel(label);
    setShowTimeTravelModal(false);
    void refresh('auto', at);
  }, [refresh, setTimeTravelAt]);

  const handleResume = useCallback(() => {
    setTimeTravelAt(null);
    setTimeTravelLabel(null);
    setShowTimeTravelModal(false);
    void refresh('user', undefined, true);
  }, [refresh, setTimeTravelAt]);

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.container} testID="home-loading">
        <StateBlock
          loading
          title="Club 32"
          body="Loading ride data…"
        />
      </SafeAreaView>
    );
  }

  const walkOrigin = (chip || sortBy === 'distance' || sortBy === 'opportunity') ? locationCoords : null;

  // Apply daily-park filter before flattening so the list (and any sort)
  // only sees rides in the selected park scope.
  const scopedData = data && dailyContext
    ? filterByDailyParks(data, dailyContext.parks)
    : data;

  const landOptions: LandOption[] = scopedData
    ? successfulParks(scopedData).flatMap(p =>
        [...new Set(p.rides.map(r => r.land))]
          .sort((a, b) => a.localeCompare(b))
          .map(land => ({ land, park: p.park }))
      )
    : [];

  // Nearby without a fix shows the location prompt in place of the list.
  const nearbyNeedsLocation = chip === 'nearby' && !locationCoords;

  const baseItems: ListItem[] = !scopedData
    ? []
    : chip === 'nearby'
    ? (locationCoords ? nearbyItems(scopedData, locationCoords, persona) : [])
    : chip === 'land'
    ? filterRides(flattenSorted(scopedData, 'opportunity', locationCoords, persona), r => r.land === selectedLand)
    : chip === 'list'
    ? filterRides(flattenSorted(scopedData, 'opportunity', locationCoords, persona), r => mustDoSet.has(r.id))
    : sortBy
    ? flattenSorted(scopedData, sortBy, locationCoords, persona)
    : flattenForList(scopedData);
  const items = filterItemsByQuery(baseItems, searchQuery);
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
        title="Discover"
        subtitle={
          debugMode ? (
            <Pressable onPress={() => setShowTimeTravelModal(true)} testID="time-travel-trigger">
              <Text
                style={timeTravelAt ? gradientHeaderTextStyles.subtitleActive : gradientHeaderTextStyles.subtitle}
                testID="last-update"
              >
                {timeTravelAt ? `Time set to: ${timeTravelLabel}` : `Last update: ${lastUpdate}`}
              </Text>
            </Pressable>
          ) : (
            <Text style={gradientHeaderTextStyles.subtitle} testID="last-update">
              {`Last update: ${lastUpdate}`}
            </Text>
          )
        }
        right={
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowSortMenu(true)}
              testID="sort-button"
              style={styles.sortButton}
            >
              <ArrowUpDown size={20} color={sortBy && !chip ? colors.textInverse : 'rgba(255,255,255,0.65)'} />
            </Pressable>
            <NotificationBellButton />
          </>
        }
      />
      <SearchField
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search attractions"
        containerStyle={styles.search}
        testID="home-search"
      />
      <DiscoverChips
        active={chip}
        landLabel={selectedLand}
        onNearby={() => setChip('nearby')}
        onLand={() => setShowLandPicker(true)}
        onList={() => setChip('list')}
      />
      {nearbyNeedsLocation ? (
        <NearbyLocationState
          status={locationStatus}
          onRequestPermission={requestPermission}
          onRetry={retry}
        />
      ) : (
      <FlatList
        data={items}
        keyExtractor={item => item.key}
        renderItem={({ item }) => (
          <ListRow
            item={item}
            walkOrigin={walkOrigin}
            mustDoSet={mustDoSet}
            onRidePress={(rideId) => openDetail({ rideId, type: null, source: 'browse' })}
          />
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
          ) : searchQuery.trim() ? (
            <StateBlock
              icon={<SearchX size={48} color={colors.textTertiary} />}
              title="No rides match"
              body={`Nothing found for "${searchQuery.trim()}".`}
              testID="search-empty-state"
            />
          ) : chip === 'list' ? (
            <StateBlock
              icon={<Bookmark size={48} color={colors.textTertiary} />}
              title="Your list is empty"
              body="Tap Watch on a ride to add it here."
              testID="list-empty-state"
            />
          ) : null
        }
        contentContainerStyle={[
          items.length === 0 ? styles.emptyListContent : undefined,
          styles.listContent,
        ]}
      />
      )}
      <SortMenu
        visible={showSortMenu}
        current={chip ? undefined : sortBy}
        distanceAvailable={locationCoords !== null && locationStatus === 'ready'}
        onSelect={handleSortSelect}
        onClose={() => setShowSortMenu(false)}
      />
      <LandPickerSheet
        visible={showLandPicker}
        lands={landOptions}
        selected={chip === 'land' ? selectedLand : null}
        showPark={dailyContext?.parks === 'both'}
        onSelect={(land) => {
          setSelectedLand(land);
          setChip('land');
          setShowLandPicker(false);
        }}
        onClose={() => setShowLandPicker(false)}
      />
      <TimeTravelModal
        visible={showTimeTravelModal}
        onSet={handleTimeTravelSet}
        onResume={handleResume}
      />
    </SafeAreaView>
  );
}

// Walk-time-limited list for the Nearby chip, across every park in scope.
function nearbyItems(
  data: CombinedResponse,
  origin: { lat: number; lng: number },
  persona: Persona | null
): ListItem[] {
  const keep = nearbyRideIds(successfulParks(data).flatMap(p => p.rides), origin);
  return filterRides(flattenSorted(data, 'nearby', origin, persona), r => keep.has(r.id));
}

// Mirrors the Recommendations location states. The needs-permission button
// must stay "Continue" and fire the OS dialog (App Store 5.1.1(iv)).
function NearbyLocationState({
  status,
  onRequestPermission,
  onRetry,
}: {
  status: ReturnType<typeof useLocation>['status'];
  onRequestPermission: () => void;
  onRetry: () => void;
}) {
  if (status === 'needs-permission') {
    return (
      <StateBlock
        icon={<MapPin size={48} color={colors.brand} />}
        title="Find rides near you"
        body="Club 32 uses your location to sort rides by how far you are and estimate walk times."
        action={{ label: 'Continue', onPress: onRequestPermission, testID: 'nearby-enable-location' }}
        testID="nearby-location-permission"
      />
    );
  }
  if (status === 'denied') {
    return (
      <StateBlock
        icon={<MapPinOff size={48} color={colors.textTertiary} />}
        title="Location access needed"
        body="Club 32 uses your location to sort rides by how far you are. Turn it on in Settings, then come back."
        action={{ label: 'Open Settings', onPress: () => void Linking.openSettings(), testID: 'nearby-open-settings' }}
        testID="nearby-location-denied"
      />
    );
  }
  if (status === 'gps-error') {
    return (
      <StateBlock
        icon={<LocateOff size={48} color={colors.textTertiary} />}
        title="Can't find your location"
        body="We couldn't get a GPS fix. Check that Location Services is on, then try again."
        action={{ label: 'Try again', onPress: onRetry, testID: 'nearby-retry-location' }}
        testID="nearby-location-error"
      />
    );
  }
  return (
    <StateBlock
      icon={<LocateFixed size={48} color={colors.brand} />}
      title="Finding your location"
      body="Hang on just a moment."
      testID="nearby-locating"
    />
  );
}

function ListRow({
  item,
  walkOrigin,
  mustDoSet,
  onRidePress,
}: {
  item: ListItem;
  walkOrigin: { lat: number; lng: number } | null;
  mustDoSet: ReadonlySet<string>;
  onRidePress: (rideId: string) => void;
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
  return (
    <RideRow
      ride={item.ride}
      walkOrigin={walkOrigin}
      isWatching={mustDoSet.has(item.ride.id)}
      onPress={() => onRidePress(item.ride.id)}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  emptyListContent: { flexGrow: 1 },
  listContent: { paddingBottom: 16 },
  // Pill shape carried over from the old floating search bar.
  search: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    borderRadius: radius.pill,
    borderColor: colors.borderStrong,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
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
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  sortButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 4,
  },
  parkHeader: {
    backgroundColor: colors.bg,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  parkHeaderErrored: { backgroundColor: '#fde2e2' }, // TODO: tokenize
  parkHeaderText: { fontSize: 18, fontWeight: '700' },
  parkHeaderErrText: { fontSize: 12, color: '#7a1f1f', marginTop: 2 }, // TODO: tokenize
  landHeader: {
    paddingHorizontal: 24,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  landHeaderText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
});
