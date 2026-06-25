// Half-sheet for the "Where are you?" picker.
//
// v3 behavior:
//   - When restrictToParks is a single park (DLR or DCA), we show only
//     that park's rides.
//   - When restrictToParks is 'both' (Park Hopper), we show a combined
//     ride list from both parks, with the park labeled under each ride.

import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/tokens';
import { DailyParks, ParkSlug, Ride } from '../types';
import { Card } from './Card';
import { SearchField } from './SearchField';
import { Sheet } from './Sheet';

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
  ridesByPark: Record<ParkSlug, Ride[]>;
  restrictToParks: DailyParks;
  onSubmit: (park: ParkSlug, currentRideId: string) => void;
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
    <Sheet
      isOpen={visible}
      onClose={onClose}
      size="tall"
      title="Which ride are you at?"
      sheetColor={colors.surface}
      testID="picker"
    >
      <Text style={styles.scopeLabel}>{scopeTitle}</Text>
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
        <Card flush style={styles.listCard}>
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
        </Card>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scopeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  searchWrap: {
    marginBottom: 12,
  },
  listCard: {
    // Don't let the card grow to fill — let it size to its rows but allow
    // its FlatList child to scroll if there are many.
    flexShrink: 1,
  },
  rideList: {
    flexGrow: 0,
  },
  rideRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rideName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222', // TODO: tokenize
  },
  rideLand: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textTertiary,
    marginTop: 24,
    textAlign: 'center',
  },
});
