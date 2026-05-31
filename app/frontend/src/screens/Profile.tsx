// Profile tab: read-out of the persona with tap-to-edit on each row.
// Long-press the header (in __DEV__) clears persona + daily context so
// onboarding can be tested without uninstalling the app.

import React, { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePersona } from '../context/PersonaContext';
import { useDailyContext } from '../context/DailyContextContext';
import { useDebugMode } from '../context/DebugModeContext';
import { useRides } from '../context/RideContext';
import {
  AccessibilityNeed,
  Persona,
  RideCategory,
  TripDuration,
} from '../types';
import {
  PersonaField,
  PersonaFieldModal,
} from '../components/PersonaFieldModal';

const TRIP_DURATION_LABELS: Record<TripDuration, string> = {
  '1-day': '1 day',
  '2-days': '2 days',
  '3-4-days': '3–4 days',
  '5-plus-days': '5+ days',
};

const RIDE_CATEGORY_LABELS: Record<RideCategory, string> = {
  thrills: 'Thrills',
  classics: 'Classics',
  immersive: 'Immersive',
  'kid-favorites': 'Kid favorites',
  'shows-characters': 'Shows & characters',
  'first-time': 'First time',
};

const ACCESSIBILITY_LABELS: Record<AccessibilityNeed, string> = {
  stroller: 'Stroller',
  wheelchair: 'Wheelchair / scooter',
  pregnant: 'Pregnant',
  sensory: 'Sensory / DAS',
  none: "None",
};

export function Profile(): React.ReactElement {
  const { persona, clearPersona } = usePersona();
  const { clearDailyContext } = useDailyContext();
  const { debugMode, setDebugMode } = useDebugMode();
  const { data } = useRides();
  const [editing, setEditing] = useState<PersonaField | null>(null);

  if (!persona) {
    // Shouldn't happen — RootNavigator gates this screen behind persona !== null.
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.placeholder}>No profile yet.</Text>
      </SafeAreaView>
    );
  }

  const resetForTesting = async () => {
    await Promise.all([clearPersona(), clearDailyContext()]);
  };

  const mustDoNames = persona.mustDoRideIds
    .map(id => data?.parks
      .flatMap(p => ('rides' in p ? p.rides : []))
      .find(r => r.id === id)?.name)
    .filter((n): n is string => typeof n === 'string');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.subtitle}>Tap any row to edit.</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Row
          label="Trip length"
          value={persona.tripDuration ? TRIP_DURATION_LABELS[persona.tripDuration] : 'Not set'}
          onPress={() => setEditing('tripDuration')}
        />
        <Row
          label="Youngest in group"
          value={
            persona.youngestAge === null
              ? 'Not set'
              : persona.youngestAge >= 18
              ? 'All adults'
              : `${persona.youngestAge} years old`
          }
          onPress={() => setEditing('youngestAge')}
        />
        <Row
          label="Ride preferences"
          value={
            persona.ridePreferences.length === 0
              ? 'Not set'
              : persona.ridePreferences.map(c => RIDE_CATEGORY_LABELS[c]).join(', ')
          }
          onPress={() => setEditing('ridePreferences')}
        />
        <Row
          label="Must-do rides"
          value={mustDoNames.length === 0 ? 'None picked' : mustDoNames.join(', ')}
          onPress={() => setEditing('mustDoRideIds')}
        />
        <Row
          label="Accessibility"
          value={
            persona.accessibilityNeeds.length === 0
              ? 'Not set'
              : persona.accessibilityNeeds.map(n => ACCESSIBILITY_LABELS[n]).join(', ')
          }
          onPress={() => setEditing('accessibilityNeeds')}
        />

        <Pressable
          onPress={() => void setDebugMode(!debugMode)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          testID="debug-mode-toggle"
        >
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Debug mode</Text>
            <Text style={[styles.rowValue, debugMode && styles.debugModeOn]}>
              {debugMode ? 'On — fake GPS via ride picker' : 'Off'}
            </Text>
          </View>
          <Text style={styles.rowChevron}>›</Text>
        </Pressable>

        <Pressable
          onPress={() => void resetForTesting()}
          style={({ pressed }) => [styles.resetButton, pressed && styles.resetButtonPressed]}
          testID="debug-reset"
        >
          <Text style={styles.resetText}>Reset persona (dev)</Text>
        </Pressable>
      </ScrollView>

      <PersonaFieldModal field={editing} onClose={() => setEditing(null)} />
    </SafeAreaView>
  );
}

interface RowProps {
  label: string;
  value: string;
  onPress: () => void;
}

function Row({ label, value, onPress }: RowProps): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    padding: 16,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#111' },
  subtitle: { fontSize: 13, color: '#666', marginTop: 2 },
  scroll: { paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  rowPressed: { backgroundColor: '#f4f4ff' },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 },
  rowValue: { fontSize: 16, color: '#222', marginTop: 4 },
  rowChevron: { fontSize: 22, color: '#bbb', marginLeft: 8 },
  placeholder: { padding: 32, fontSize: 14, color: '#999', textAlign: 'center' },
  resetButton: {
    marginTop: 32,
    marginHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c41e3a',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  resetButtonPressed: { opacity: 0.6 },
  resetText: { color: '#c41e3a', fontSize: 14, fontWeight: '600' },
  debugModeOn: { color: '#f5a623', fontWeight: '600' },
});
