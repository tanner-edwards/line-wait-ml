// Dumb list of notification-type toggles. Pure props — takes the current
// types object and an onChange callback. Used inside NotificationSettingsModal
// (a thin smart wrapper that wires this to the device record).

import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { CircleCheck, OctagonX, Star, TrendingUp } from 'lucide-react-native';
import { colors } from '../theme/tokens';
import { NotificationKind, NotificationTypes } from '../types';

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

interface Props {
  types: NotificationTypes;
  onChange: (kind: NotificationKind, enabled: boolean) => void;
}

export function NotificationToggleList({ types, onChange }: Props): React.ReactElement {
  return (
    <>
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
            value={types[row.kind]}
            onValueChange={enabled => onChange(row.kind, enabled)}
            testID={`notif-toggle-${row.kind}`}
          />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  rowText: { flex: 1, paddingRight: 12 },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  rowTitle: { fontSize: 15, color: colors.textPrimary, fontWeight: '600' },
  rowSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
});
