// Profile tab — card-grouped sections, iOS Settings pattern.
// Three sections: Your Visit | Notifications | Debug
// Debug section is always shown but visually muted; it's the user's access
// point for debug mode and the ride-picker GPS override in Recommendations.

import React, { useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { usePersona } from '../context/PersonaContext';
import { useDailyContext } from '../context/DailyContextContext';
import { useDebugMode } from '../context/DebugModeContext';
import { useDevice } from '../context/DeviceContext';
import { useRides } from '../context/RideContext';
import { useAuth } from '../context/AuthContext';
import { useTrip } from '../context/TripContext';
import { deleteAccount } from '../api';
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
import { DailyParkSheet } from '../components/DailyParkSheet';
import { DebugLogModal } from '../components/DebugLogModal';
import { TapEditRow } from '../components/TapEditRow';
import { ToggleRow } from '../components/ToggleRow';
import { GradientHeader } from '../components/GradientHeader';
import { SectionHeader } from '../components/SectionHeader';
import { Card } from '../components/Card';
import { colors, spacing } from '../theme/tokens';

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
  none: 'None',
};

export function Profile(): React.ReactElement {
  const { persona, clearPersona } = usePersona();
  const { context: dailyCtx, clearDailyContext } = useDailyContext();
  const { debugMode, setDebugMode } = useDebugMode();
  const {
    notificationsEnabled,
    notificationTypes,
    enableNotifications,
    disableNotifications,
    setNotificationTypeEnabled,
  } = useDevice();
  const { data } = useRides();
  const { user, userRecord, getIdToken, signOut } = useAuth();
  const { trip } = useTrip();
  const [editing, setEditing] = useState<PersonaField | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [parkPickerOpen, setParkPickerOpen] = useState(false);

  if (!persona) {
    return (
      <SafeAreaView style={styles.container}>
        <GradientHeader title="Profile" />
        <Text style={styles.placeholder}>No profile yet.</Text>
      </SafeAreaView>
    );
  }

  const resetForTesting = async () => {
    await Promise.all([clearPersona(), clearDailyContext()]);
  };

  const allRides = data?.parks.flatMap(p => ('rides' in p ? p.rides : [])) ?? [];

  const mustDoNames = persona.mustDoRideIds
    .map(id => allRides.find(r => r.id === id)?.name)
    .filter((n): n is string => typeof n === 'string');

  const mustDoValue =
    mustDoNames.length === 0 ? 'None picked' :
    mustDoNames.length <= 2 ? mustDoNames.join(', ') :
    `${mustDoNames.slice(0, 2).join(', ')} +${mustDoNames.length - 2} more`;

  return (
    <SafeAreaView style={styles.container}>
      <GradientHeader title="Profile" />

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Your Visit ─────────────────────────────── */}
        <SectionHeader title="Your Visit" />
        <Card flush style={styles.sectionCard}>
          <TapEditRow
            label="Trip length"
            value={persona.tripDuration ? TRIP_DURATION_LABELS[persona.tripDuration] : 'Not set'}
            onPress={() => setEditing('tripDuration')}
          />
          <TapEditRow
            label="Youngest in group"
            value={
              persona.youngestAge === null ? 'Not set' :
              persona.youngestAge >= 18 ? 'All adults' :
              `${persona.youngestAge} years old`
            }
            onPress={() => setEditing('youngestAge')}
          />
          <TapEditRow
            label="Ride preferences"
            value={
              persona.ridePreferences.length === 0 ? 'Not set' :
              persona.ridePreferences.map(c => RIDE_CATEGORY_LABELS[c]).join(', ')
            }
            onPress={() => setEditing('ridePreferences')}
          />
          <TapEditRow
            label="Must-do rides"
            value={mustDoValue}
            onPress={() => setEditing('mustDoRideIds')}
            numberOfLines={1}
          />
          <TapEditRow
            label="Accessibility"
            value={
              persona.accessibilityNeeds.length === 0 ? 'Not set' :
              persona.accessibilityNeeds.map(n => ACCESSIBILITY_LABELS[n]).join(', ')
            }
            onPress={() => setEditing('accessibilityNeeds')}
          />
          <TapEditRow
            label="Today's parks"
            value={DAILY_PARKS_LABELS[dailyCtx?.parks ?? 'both']}
            onPress={() => setParkPickerOpen(true)}
          />
        </Card>

        {/* ── Notifications ──────────────────────────── */}
        <SectionHeader title="Notifications" />
        <Card flush style={styles.sectionCard}>
          <ToggleRow
            label="Enable notifications"
            value={notificationsEnabled ? 'Heads-up on your must-do rides' : 'Off'}
            enabled={notificationsEnabled}
            onValueChange={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              void (notificationsEnabled ? disableNotifications() : enableNotifications());
            }}
            testID="notifications-toggle"
          />
          {notificationsEnabled ? (
            <>
              <ToggleRow
                label="Wait-time opportunities"
                enabled={notificationTypes.trough}
                onValueChange={v => void setNotificationTypeEnabled('trough', v)}
                testID="notif-toggle-trough"
              />
              <ToggleRow
                label="Ride closes"
                enabled={notificationTypes.closure}
                onValueChange={v => void setNotificationTypeEnabled('closure', v)}
                testID="notif-toggle-closure"
              />
              <ToggleRow
                label="Ride reopens"
                enabled={notificationTypes.reopen}
                onValueChange={v => void setNotificationTypeEnabled('reopen', v)}
                testID="notif-toggle-reopen"
              />
              <ToggleRow
                label="Peak wait alert"
                enabled={notificationTypes.peak}
                onValueChange={v => void setNotificationTypeEnabled('peak', v)}
                testID="notif-toggle-peak"
              />
            </>
          ) : null}
        </Card>

        {/* ── Account ────────────────────────────────── */}
        <SectionHeader title="Account" />
        <Card flush style={styles.sectionCard}>
          <TapEditRow
            label="Signed in as"
            value={user?.email ?? userRecord?.userId?.slice(0, 12) ?? 'Apple account'}
            onPress={() => undefined}
          />
          {trip ? (
            <TapEditRow
              label="Active trip"
              value={`${trip.tripStart} – ${trip.tripEnd}`}
              onPress={() => undefined}
            />
          ) : null}
          <Pressable
            onPress={() => void signOut()}
            style={({ pressed }) => [styles.resetRow, pressed && styles.resetRowPressed]}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Alert.alert(
                'Delete account',
                'This permanently removes your account, trip history, and device records. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      const token = await getIdToken();
                      if (token) await deleteAccount(token);
                      await Promise.all([clearPersona(), clearDailyContext()]);
                      await signOut();
                    },
                  },
                ]
              );
            }}
            style={({ pressed }) => [styles.resetRow, pressed && styles.resetRowPressed]}
          >
            <Text style={styles.deleteText}>Delete account</Text>
          </Pressable>
        </Card>

        {/* ── Debug ──────────────────────────────────── */}
        <SectionHeader title="Debug" />
        <Card flush style={styles.debugSectionCard}>
          <ToggleRow
            label="Debug mode"
            value={debugMode ? 'On — fake GPS via ride picker' : 'Off'}
            valueColor={debugMode ? colors.textTertiary : undefined}
            enabled={debugMode}
            onValueChange={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              void setDebugMode(!debugMode);
            }}
            testID="debug-mode-toggle"
          />
          {debugMode ? (
            <TapEditRow
              label="View logs"
              value="Session diagnostics — push, arm, errors"
              onPress={() => setLogsOpen(true)}
              testID="debug-view-logs"
            />
          ) : null}
          <Pressable
            onPress={() => void resetForTesting()}
            style={({ pressed }) => [styles.resetRow, pressed && styles.resetRowPressed]}
            testID="debug-reset"
          >
            <Text style={styles.resetText}>Reset persona</Text>
          </Pressable>
        </Card>

      </ScrollView>

      <PersonaFieldModal field={editing} onClose={() => setEditing(null)} />
      <DailyParkSheet
        visible={parkPickerOpen}
        onSelect={() => setParkPickerOpen(false)}
        onCancel={() => setParkPickerOpen(false)}
      />
      <DebugLogModal visible={logsOpen} onClose={() => setLogsOpen(false)} />
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.base, paddingTop: spacing.sm, paddingBottom: spacing.xxxl },
  sectionCard: { marginBottom: spacing.xl },
  debugSectionCard: { marginBottom: spacing.xl, borderColor: colors.borderStrong },
  resetRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    backgroundColor: colors.surface,
  },
  resetRowPressed: { opacity: 0.6 },
  resetText: { fontSize: 16, color: colors.skip },
  signOutText: { fontSize: 16, color: colors.brand },
  deleteText: { fontSize: 16, color: colors.skip },
  placeholder: { padding: 32, fontSize: 14, color: colors.textTertiary, textAlign: 'center' },
});
