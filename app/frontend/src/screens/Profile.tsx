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
import { useDevice } from '../context/DeviceContext';
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
import { NotificationSettingsModal } from '../components/NotificationSettingsModal';
import { DailyParkSheet } from '../components/DailyParkSheet';
import { DebugLogModal } from '../components/DebugLogModal';
import { TapEditRow } from '../components/TapEditRow';
import { GradientHeader } from '../components/GradientHeader';
import { colors } from '../theme/tokens';

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

const DAILY_PARKS_LABELS: Record<string, string> = {
  disneyland: 'Disneyland',
  'california-adventure': 'Disney California Adventure',
  both: 'Both parks (hopping)',
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
  const { context: dailyCtx, clearDailyContext } = useDailyContext();
  const { debugMode, setDebugMode } = useDebugMode();
  const {
    notificationsEnabled,
    notificationTypes,
    busy: deviceBusy,
    error: deviceError,
    enableNotifications,
    disableNotifications,
  } = useDevice();
  const { data } = useRides();
  const [editing, setEditing] = useState<PersonaField | null>(null);
  const [notifSettingsOpen, setNotifSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  if (!persona) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.placeholder}>No profile yet.</Text>
      </SafeAreaView>
    );
  }

  const [parkPickerOpen, setParkPickerOpen] = useState(false);

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
      <GradientHeader title="Profile" subtitle="Tap any row to edit." />

      <ScrollView contentContainerStyle={styles.scroll}>
        <TapEditRow
          label="Trip length"
          value={persona.tripDuration ? TRIP_DURATION_LABELS[persona.tripDuration] : 'Not set'}
          onPress={() => setEditing('tripDuration')}
        />
        <TapEditRow
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
        <TapEditRow
          label="Ride preferences"
          value={
            persona.ridePreferences.length === 0
              ? 'Not set'
              : persona.ridePreferences.map(c => RIDE_CATEGORY_LABELS[c]).join(', ')
          }
          onPress={() => setEditing('ridePreferences')}
        />
        <TapEditRow
          label="Must-do rides"
          value={mustDoNames.length === 0 ? 'None picked' : mustDoNames.join(', ')}
          onPress={() => setEditing('mustDoRideIds')}
        />
        <TapEditRow
          label="Accessibility"
          value={
            persona.accessibilityNeeds.length === 0
              ? 'Not set'
              : persona.accessibilityNeeds.map(n => ACCESSIBILITY_LABELS[n]).join(', ')
          }
          onPress={() => setEditing('accessibilityNeeds')}
        />
        <TapEditRow
          label="Today's parks"
          value={DAILY_PARKS_LABELS[dailyCtx?.parks ?? 'both']}
          onPress={() => setParkPickerOpen(true)}
        />

        <Pressable
          onPress={() => {
            if (deviceBusy) return;
            void (notificationsEnabled ? disableNotifications() : enableNotifications());
          }}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          testID="notifications-toggle"
          disabled={deviceBusy}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Enable notifications</Text>
            <Text style={[styles.rowValue, notificationsEnabled && styles.notificationsOn]}>
              {notificationsEnabled
                ? 'On — heads-up on your must-do rides'
                : 'Off'}
            </Text>
            {deviceError ? (
              <Text style={styles.errorText} testID="device-error">{deviceError}</Text>
            ) : null}
          </View>
          <Text style={styles.rowChevron}>›</Text>
        </Pressable>

        {notificationsEnabled ? (
          <Pressable
            onPress={() => setNotifSettingsOpen(true)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            testID="notification-types"
          >
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Notification types</Text>
              <Text style={styles.rowValue}>{notificationTypesSummary(notificationTypes)}</Text>
            </View>
            <Text style={styles.rowChevron}>›</Text>
          </Pressable>
        ) : null}

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

        {debugMode ? (
          <Pressable
            onPress={() => setLogsOpen(true)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            testID="debug-view-logs"
          >
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>View logs</Text>
              <Text style={styles.rowValue}>Session diagnostics — push, arm, errors</Text>
            </View>
            <Text style={styles.rowChevron}>›</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => void resetForTesting()}
          style={({ pressed }) => [styles.resetButton, pressed && styles.resetButtonPressed]}
          testID="debug-reset"
        >
          <Text style={styles.resetText}>Reset persona (dev)</Text>
        </Pressable>
      </ScrollView>

      <PersonaFieldModal field={editing} onClose={() => setEditing(null)} />
      <DailyParkSheet
        visible={parkPickerOpen}
        onSelect={() => setParkPickerOpen(false)}
        onCancel={() => setParkPickerOpen(false)}
      />
      <NotificationSettingsModal
        visible={notifSettingsOpen}
        onClose={() => setNotifSettingsOpen(false)}
      />
      <DebugLogModal visible={logsOpen} onClose={() => setLogsOpen(false)} />
    </SafeAreaView>
  );
}

function notificationTypesSummary(types: { trough: boolean; closure: boolean; reopen: boolean }): string {
  const on = [
    types.trough && 'opportunities',
    types.closure && 'closures',
    types.reopen && 'reopens',
  ].filter((x): x is string => typeof x === 'string');
  if (on.length === 3) return 'All on';
  if (on.length === 0) return 'All off';
  return `${on.join(', ')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' }, // TODO: tokenize
  scroll: { paddingBottom: 24 },
  // Rows below keep their own styles because they have non-standard content
  // (status text, inline error, conditional values). TapEditRow handles the
  // simple label + value + chevron cases above.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee', // TODO: tokenize
  },
  rowPressed: { backgroundColor: '#f4f4ff' }, // TODO: tokenize
  rowText: { flex: 1 },
  rowLabel: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 }, // TODO: tokenize
  rowValue: { fontSize: 16, color: '#222', marginTop: 4 }, // TODO: tokenize
  rowChevron: { fontSize: 22, color: '#bbb', marginLeft: 8 }, // TODO: tokenize
  placeholder: { padding: 32, fontSize: 14, color: '#999', textAlign: 'center' }, // TODO: tokenize
  resetButton: {
    marginTop: 32,
    marginHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.skip,
    backgroundColor: '#fff', // TODO: tokenize
    alignItems: 'center',
  },
  resetButtonPressed: { opacity: 0.6 },
  resetText: { color: colors.skip, fontSize: 14, fontWeight: '600' },
  debugModeOn: { color: '#f5a623', fontWeight: '600' }, // TODO: tokenize
  notificationsOn: { color: colors.brand, fontWeight: '600' },
  errorText: { color: colors.skip, fontSize: 12, marginTop: 6 },
});
