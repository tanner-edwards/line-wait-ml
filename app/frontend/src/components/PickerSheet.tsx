// Half-sheet modal for the "Where are you?" picker. Two-step flow: pick park,
// then pick the ride you're currently at. Pre-fills both when reopened with
// an existing selection so re-confirming is one tap.
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
  TextInput,
  View,
} from 'react-native';
import { ParkSlug, Ride } from '../types';

const PARK_LABEL: Record<ParkSlug, string> = {
  'disneyland': 'Disneyland',
  'california-adventure': 'Disney California Adventure',
};
const PARK_DISPLAY_NAME: Record<ParkSlug, string> = {
  // The backend's combined response uses these display names per park entry;
  // we match them so we can filter `data.parks[i].rides` by slug.
  'disneyland': 'Disneyland',
  'california-adventure': 'Disney California Adventure',
};

const PARK_OPTIONS: ParkSlug[] = ['disneyland', 'california-adventure'];

export function parkDisplayName(slug: ParkSlug): string {
  return PARK_DISPLAY_NAME[slug];
}

interface PickerSheetProps {
  visible: boolean;
  initialPark?: ParkSlug | null;
  initialRideId?: string | null;
  /** All rides keyed by park slug. Provided by the Recommendations screen
   *  from RideContext.data. Used to populate the RidePicker step. */
  ridesByPark: Record<ParkSlug, Ride[]>;
  /** Called when the user picks a ride. Sheet auto-dismisses on submit. */
  onSubmit: (park: ParkSlug, currentRideId: string) => void;
  /** Called when the user dismisses without picking (back-button / backdrop). */
  onClose: () => void;
}

export function PickerSheet({
  visible,
  initialPark,
  initialRideId: _initialRideId,
  ridesByPark,
  onSubmit,
  onClose,
}: PickerSheetProps): React.ReactElement {
  // Two-step state. `selectedPark` null → show park picker. Non-null → show
  // ride picker for that park.
  const [selectedPark, setSelectedPark] = useState<ParkSlug | null>(initialPark ?? null);
  const [query, setQuery] = useState('');

  // Pre-fill the park selection whenever the sheet opens.
  useEffect(() => {
    if (visible) {
      setSelectedPark(initialPark ?? null);
      setQuery('');
    }
  }, [visible, initialPark]);

  const filteredRides = useMemo<Ride[]>(() => {
    if (!selectedPark) return [];
    const rides = ridesByPark[selectedPark] ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rides;
    return rides.filter(r => r.name.toLowerCase().includes(q));
  }, [selectedPark, ridesByPark, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="picker-backdrop">
        {/* Inner Pressable swallows backdrop taps so taps inside the card don't dismiss. */}
        <Pressable style={styles.card} onPress={() => {}}>
          {selectedPark === null ? (
            <ParkPickerStep onPick={setSelectedPark} />
          ) : (
            <RidePickerStep
              park={selectedPark}
              query={query}
              setQuery={setQuery}
              rides={filteredRides}
              onPickRide={(rideId) => onSubmit(selectedPark, rideId)}
              onChangePark={() => setSelectedPark(null)}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ParkPickerStep({ onPick }: { onPick: (p: ParkSlug) => void }): React.ReactElement {
  return (
    <View>
      <Text style={styles.title}>Where are you?</Text>
      <Text style={styles.subtitle}>Pick a park first.</Text>
      <View style={styles.parkButtonRow}>
        {PARK_OPTIONS.map(slug => (
          <Pressable
            key={slug}
            style={styles.parkButton}
            onPress={() => onPick(slug)}
            testID={`park-pick-${slug}`}
          >
            <Text style={styles.parkButtonText}>{PARK_LABEL[slug]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function RidePickerStep({
  park,
  query,
  setQuery,
  rides,
  onPickRide,
  onChangePark,
}: {
  park: ParkSlug;
  query: string;
  setQuery: (s: string) => void;
  rides: Ride[];
  onPickRide: (rideId: string) => void;
  onChangePark: () => void;
}): React.ReactElement {
  return (
    <View style={styles.ridePickerContainer}>
      <View style={styles.headerRow}>
        <Pressable onPress={onChangePark} testID="picker-change-park">
          <Text style={styles.backLink}>← {PARK_LABEL[park]}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>Which ride are you at?</Text>
      <TextInput
        style={styles.search}
        placeholder="Search rides…"
        placeholderTextColor="#aaa"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        testID="picker-search"
      />
      {rides.length === 0 ? (
        <Text style={styles.emptyText}>
          {query ? 'No rides match that search.' : 'No rides available yet.'}
        </Text>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={r => r.id}
          keyboardShouldPersistTaps="handled"
          style={styles.rideList}
          renderItem={({ item }) => (
            <Pressable
              style={styles.rideRow}
              onPress={() => onPickRide(item.id)}
              testID={`picker-ride-${item.id}`}
            >
              <Text style={styles.rideName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rideLand}>{item.land}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
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
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#222',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },

  parkButtonRow: {
    gap: 12,
  },
  parkButton: {
    backgroundColor: '#6b6bf5',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
  },
  parkButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  ridePickerContainer: {
    flex: 1,
  },
  headerRow: {
    marginBottom: 12,
  },
  backLink: {
    color: '#6b6bf5',
    fontSize: 14,
    fontWeight: '600',
  },
  search: {
    backgroundColor: '#f4f4f7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
    color: '#222',
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
