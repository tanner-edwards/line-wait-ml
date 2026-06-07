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
import { CircleCheck, OctagonX, Star, TrendingUp } from 'lucide-react-native';
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
  icon: React.ReactElement;
  title: string;
  subtitle: string;
}

const ROWS: Row[] = [
  {
    kind: 'trough',
    icon: <Star size={18} color={colors.star} fill={colors.star} />,
    title: 'Wait-time opportunities',
    subtitle: 'Alerts when a must-do ride hits a short-wait window.',
  },
  {
    kind: 'closure',
    icon: <OctagonX size={18} color={colors.skip} />,
    title: 'Ride closes',
    subtitle: "Heads-up when one of your must-do rides goes down.",
  },
  {
    kind: 'reopen',
    icon: <CircleCheck size={18} color={colors.go} />,
    title: 'Ride reopens',
    subtitle: "Pings you when a closed must-do ride comes back online.",
  },
  {
    kind: 'peak',
    icon: <TrendingUp size={18} color={colors.star} />,
    title: 'Peak wait alert',
    subtitle: "Off by default. Alerts when a must-do ride hits peak crowd levels.",
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
            <View style={styles.rowTitleRow}>
              {row.icon}
              <Text style={styles.rowTitle}> {row.title}</Text>
            </View>
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
        Notifications only send while you're at the park.
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
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  rowTitle: { fontSize: 15, color: '#222', fontWeight: '600' }, // TODO: tokenize
  rowSubtitle: { fontSize: 12, color: '#666', marginTop: 3 }, // TODO: tokenize
  footer: { fontSize: 11, color: colors.textTertiary, marginTop: 14, textAlign: 'center' },
});
