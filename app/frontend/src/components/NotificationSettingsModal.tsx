// Bottom-sheet for per-type notification opt-ins. Four toggles:
// trough (⭐/✅ good windows), closure (✕ ride down), reopen (🎉 ride back up),
// peak (📈 ride at p90 — off by default). Changes persist to AsyncStorage
// and sync to the device record so the scanner respects them on the next tick.

import React from 'react';
import {
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/tokens';
import { useDevice } from '../context/DeviceContext';
import { NotificationKind } from '../types';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface Row {
  kind: NotificationKind;
  emoji: string;
  title: string;
  subtitle: string;
}

const ROWS: Row[] = [
  {
    kind: 'trough',
    emoji: '⭐',
    title: 'Wait-time opportunities',
    subtitle: 'Gold star + green check alerts when a must-do ride hits a short-wait window.',
  },
  {
    kind: 'closure',
    emoji: '✕',
    title: 'Ride closes',
    subtitle: "Heads-up when one of your must-do rides goes down.",
  },
  {
    kind: 'reopen',
    emoji: '🎉',
    title: 'Ride reopens',
    subtitle: "Pings you when a closed must-do ride comes back online.",
  },
  {
    kind: 'peak',
    emoji: '🛑',
    title: 'Peak wait alert',
    subtitle: "Off by default. Alerts when a must-do ride hits peak crowd levels — well above its typical wait.",
  },
];

export function NotificationSettingsModal({ visible, onClose }: Props): React.ReactElement {
  const { notificationTypes, setNotificationTypeEnabled } = useDevice();
  return (
    <Sheet
      isOpen={visible}
      onClose={onClose}
      title="Notification types"
      testID="notif-settings"
    >
      {ROWS.map(row => (
        <View key={row.kind} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>
              {row.emoji} {row.title}
            </Text>
            <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
          </View>
          <Switch
            value={notificationTypes[row.kind]}
            onValueChange={enabled => void setNotificationTypeEnabled(row.kind, enabled)}
            testID={`notif-toggle-${row.kind}`}
          />
        </View>
      ))}
      <Text style={styles.footer}>
        Notifications still respect "I'm at the park today" and the daily park scope.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomColor: '#eee', // TODO: tokenize
    borderBottomWidth: 1,
  },
  rowText: { flex: 1, paddingRight: 12 },
  rowTitle: { fontSize: 15, color: '#222', fontWeight: '600' }, // TODO: tokenize
  rowSubtitle: { fontSize: 12, color: '#666', marginTop: 3 }, // TODO: tokenize
  footer: { fontSize: 11, color: colors.textTertiary, marginTop: 14, textAlign: 'center' },
});
