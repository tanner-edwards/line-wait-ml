// Bottom-sheet modal for per-type notification opt-ins. Four toggles:
// trough (⭐/✅ good windows), closure (🛑 ride down), reopen (🎉 ride back up),
// peak (📈 ride at p90 — off by default). Changes persist to AsyncStorage
// and sync to the device record so the scanner respects them on the next tick.

import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useDevice } from '../context/DeviceContext';
import { NotificationKind } from '../types';

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
    emoji: '🛑',
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
    emoji: '✕',
    title: 'Peak wait alert',
    subtitle: "Off by default. Alerts when a must-do ride hits its p90 — busiest it typically gets.",
  },
];

export function NotificationSettingsModal({ visible, onClose }: Props): React.ReactElement {
  const { notificationTypes, setNotificationTypeEnabled } = useDevice();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} testID="notif-settings-backdrop" />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Notification types</Text>
            <Pressable onPress={onClose} hitSlop={12} testID="notif-settings-close">
              <Text style={styles.closeX}>✕</Text>
            </Pressable>
          </View>
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  dismissArea: { flex: 1 },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 32,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222' },
  closeX: { fontSize: 22, color: '#999' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
  },
  rowText: { flex: 1, paddingRight: 12 },
  rowTitle: { fontSize: 15, color: '#222', fontWeight: '600' },
  rowSubtitle: { fontSize: 12, color: '#666', marginTop: 3 },
  footer: { fontSize: 11, color: '#888', marginTop: 14, textAlign: 'center' },
});
