// Half-sheet modal for the "Where are you?" picker.
//
// v3 behavior:
//   - When restrictToParks is a single park (DLR or DCA), we skip the
//     park-selection step entirely and show only that park's rides.
//   - When restrictToParks is 'both' (Park Hopper), we show a combined
//     ride list from both parks, with the park labeled under each ride.
//
// Visual pattern cloned from TimeTravelModal: cross-platform RN Modal +
// transparent backdrop + slide-from-bottom card. Deliberately no native-only
// libraries — the Expo web build (S3 + CloudFront) renders this too.

import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DailyParks, ParkSlug, Ride } from '../types';
import { SearchField } from './SearchField';

const PARK_DISPLAY_NAME: Record<ParkSlug, string> = {
  'disneyland': 'Disneyland',
  'california-adventure': 'Disney California Adventure',
};

const PARK_SHORT: Record<ParkSlug, string> = {
  'disneyland': 'DLR',
  'california-adventure': 'DCA',
};

export function parkDisplayName(slug: ParkSlug): string {
  return PARK_DISPLAY_NAME[slug];
}

interface RideWithPark extends Ride {
  park: ParkSlug;
}

interface PickerSheetProps {
  visible: boolean;
  initialPark?: ParkSlug | null;
  initialRideId?: string | null;
  /** All rides keyed by park slug. Provided by the Recommendations screen
   *  from RideContext.data. */
  ridesByPark: Record<ParkSlug, Ride[]>;
  /** Daily-park scope: limits which rides appear. 'both' shows a combined
   *  list from both parks; a single park hides the other entirely. */
  restrictToParks: DailyParks;
  /** Called when the user picks a ride. Sheet auto-dismisses on submit. */
  onSubmit: (park: ParkSlug, currentRideId: string) => void;
  /** Called when the user dismisses without picking (backdrop tap). */
  onClose: () => void;
}

export function PickerSheet({
  visible,
  initialPark: _initialPark,
  initialRideId: _initialRideId,
  ridesByPark,
  restrictToParks,
  onSubmit,
  onClose,
}: PickerSheetProps): React.ReactElement {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  // Build a single flat list of rides annotated with their park. The list
  // contents depend on the daily-park scope: a single park only shows that
  // park's rides; 'both' shows both. Sorted alphabetically for searchability.
  const ridesInScope = useMemo<RideWithPark[]>(() => {
    const collect: RideWithPark[] = [];
    const slugs: ParkSlug[] =
      restrictToParks === 'both'
        ? ['disneyland', 'california-adventure']
        : [restrictToParks];
    for (const slug of slugs) {
      for (const ride of ridesByPark[slug] ?? []) {
        collect.push({ ...ride, park: slug });
      }
    }
    collect.sort((a, b) => a.name.localeCompare(b.name));
    return collect;
  }, [ridesByPark, restrictToParks]);

  const filteredRides = useMemo<RideWithPark[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ridesInScope;
    return ridesInScope.filter(r => r.name.toLowerCase().includes(q));
  }, [ridesInScope, query]);

  const showParkSubtitle = restrictToParks === 'both';
  const scopeTitle =
    restrictToParks === 'both'
      ? 'Both parks'
      : PARK_DISPLAY_NAME[restrictToParks];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="picker-backdrop">
        {/* Inner Pressable swallows backdrop taps so taps inside the card don't dismiss. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.scopeLabel}>{scopeTitle}</Text>
          <Text style={styles.title}>Which ride are you at?</Text>
          <View style={styles.searchWrap}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search rides…"
              testID="picker-search"
            />
          </View>
          {filteredRides.length === 0 ? (
            <Text style={styles.emptyText}>
              {query ? 'No rides match that search.' : 'No rides available yet.'}
            </Text>
          ) : (
            <FlatList
              data={filteredRides}
              keyExtractor={r => r.id}
              keyboardShouldPersistTaps="handled"
              style={styles.rideList}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.rideRow}
                  onPress={() => onSubmit(item.park, item.id)}
                  testID={`picker-ride-${item.id}`}
                >
                  <Text style={styles.rideName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.rideLand}>
                    {showParkSubtitle ? `${item.land} · ${PARK_SHORT[item.park]}` : item.land}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 36,
    minHeight: 380,
    maxHeight: '85%',
  },
  scopeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#222',
    marginBottom: 12,
  },
  searchWrap: {
    marginBottom: 12,
  },
  rideList: {
    flexGrow: 0,
  },
  rideRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  rideName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
  },
  rideLand: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: '#888',
    marginTop: 24,
    textAlign: 'center',
  },
});
