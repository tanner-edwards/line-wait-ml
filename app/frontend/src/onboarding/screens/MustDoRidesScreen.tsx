import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useOnboardingDraft } from '../OnboardingDraftContext';
import { OnboardingScreenShell } from './OnboardingScreenShell';
import { RowButton } from '../../components/RowButton';
import { SearchField } from '../../components/SearchField';
import { useRides } from '../../context/RideContext';
import { Ride } from '../../types';
import { OnboardingStackParamList } from '../OnboardingNavigator';
import { colors } from '../../theme/tokens';

// Curated headliners shown when nothing is searched. Substring-matched so a
// re-themed name still resolves; unknown/closed rides silently disappear.
const HEADLINER_PATTERNS: string[] = [
  'Rise of the Resistance',
  'Indiana Jones',
  'Hyperspace Mountain',
  'Radiator Springs',
  'Web Slingers',
  'Haunted Mansion',
  'Pirates of the Caribbean',
  'Guardians of the Galaxy',
  'Matterhorn',
  'Big Thunder',
];

function allRides(parksData: ReturnType<typeof useRides>['data']): Ride[] {
  if (!parksData) return [];
  return parksData.parks.flatMap(p => ('rides' in p ? p.rides : []));
}

function findHeadliners(rides: Ride[]): Ride[] {
  return HEADLINER_PATTERNS
    .map(pattern => rides.find(r => r.name.includes(pattern)))
    .filter((r): r is Ride => r !== undefined);
}

export function MustDoRidesScreen(): React.ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<OnboardingStackParamList, 'MustDoRides'>>();
  const { draft, setMustDoRideIds } = useOnboardingDraft();
  const { data } = useRides();
  const [query, setQuery] = useState('');

  const rides = useMemo(() => allRides(data), [data]);
  const selectedIds = draft.persona.mustDoRideIds;

  // "Your picks" section: every ride the user has selected so far, in
  // selection order so the most-recently added shows up at the bottom.
  const pickedRides = useMemo(
    () =>
      selectedIds
        .map(id => rides.find(r => r.id === id))
        .filter((r): r is Ride => r !== undefined),
    [selectedIds, rides]
  );

  // Suggested / search section: unselected rides only. Tapping one moves it
  // up into "Your picks" and removes it here, so the bottom list shrinks as
  // the top list grows — feels additive.
  const suggestedRides = useMemo(() => {
    const unselected = rides.filter(r => !selectedIds.includes(r.id));
    const q = query.trim().toLowerCase();
    if (q) {
      return unselected
        .filter(r => r.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return findHeadliners(unselected);
  }, [rides, selectedIds, query]);

  const toggle = (id: string) => {
    const set = new Set(selectedIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setMustDoRideIds(Array.from(set));
  };

  const advance = () => nav.navigate('AccessibilityNeeds');
  const isSearching = query.trim().length > 0;

  return (
    <OnboardingScreenShell
      step={3}
      total={5}
      title="Anything you have to do?"
      subtitle="Skip if you're flexible. Search the full catalog if you don't see one below."
      bottomLabel={selectedIds.length === 0 ? 'Skip' : 'Continue'}
      onBottomPress={advance}
    >
      <View style={styles.search}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="🔍  Search rides…"
          testID="must-do-search"
        />
      </View>

      {pickedRides.length > 0 && (
        <>
          <Text style={styles.sectionHeader} testID="must-do-picks-header">
            Your picks ({pickedRides.length})
          </Text>
          {pickedRides.map(ride => (
            <RowButton
              key={ride.id}
              title={ride.name}
              selected
              onPress={() => toggle(ride.id)}
              testID={`must-do-${ride.id}`}
            />
          ))}
          <View style={styles.divider} />
        </>
      )}

      <Text style={styles.sectionHeader}>
        {isSearching ? 'Matches' : pickedRides.length > 0 ? 'More to add' : 'Suggested'}
      </Text>
      {suggestedRides.length === 0 ? (
        <Text style={styles.emptyText}>
          {isSearching
            ? `No rides match "${query.trim()}".`
            : "You've picked all our suggestions — search above for more."}
        </Text>
      ) : (
        suggestedRides.map(ride => (
          <RowButton
            key={ride.id}
            title={ride.name}
            selected={false}
            onPress={() => toggle(ride.id)}
            testID={`must-do-${ride.id}`}
          />
        ))
      )}
    </OnboardingScreenShell>
  );
}

const styles = StyleSheet.create({
  search: {
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#eee', // TODO: tokenize
    marginVertical: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#999', // TODO: tokenize
    paddingVertical: 12,
  },
});
