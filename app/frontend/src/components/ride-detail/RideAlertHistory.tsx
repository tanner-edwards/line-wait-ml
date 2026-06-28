// "Recent alerts" tile — pure list. Driven by useRideNotificationHistory
// (in src/hooks). Returns null when there are no entries so the modal
// doesn't render an empty section.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CircleCheck, OctagonX, Star } from 'lucide-react-native';
import { colors } from '../../theme/tokens';
import { notificationBody } from '../../../../../notification-copy';
import { formatTimeAgo } from '../../timestamp';
import { NotificationLogEntry } from '../../types';
import { Tile, TileLabel } from './Tile';


interface Props {
  entries: NotificationLogEntry[];
}

export function RideAlertHistory({ entries }: Props): React.ReactElement | null {
  if (entries.length === 0) return null;
  return (
    <Tile>
      <TileLabel>Recent alerts</TileLabel>
      {entries.map(entry => {
        const icon = entry.type === 'closure' ? <OctagonX size={16} color={colors.skip} />
          : entry.type === 'peak'   ? <OctagonX size={16} color={colors.star} />
          : entry.type === 'reopen' ? <CircleCheck size={16} color={colors.go} />
          : entry.badge === 'star'  ? <Star size={16} color={colors.star} fill={colors.star} />
          : <CircleCheck size={16} color={colors.go} />;
        const body = entry.body ?? notificationBody(entry);
        return (
          <View key={`${entry.type}-${entry.firedAt}`} style={styles.row}>
            <View style={styles.iconCol}>{icon}</View>
            <View style={styles.textCol}>
              <Text style={styles.body}>{body}</Text>
            </View>
            <Text style={styles.when}>{formatTimeAgo(entry.firedAt)}</Text>
          </View>
        );
      })}
    </Tile>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  iconCol: { width: 18, marginRight: 8, marginTop: 1, alignItems: 'center' },
  textCol: { flex: 1, paddingRight: 8 },
  body: { fontSize: 13, color: colors.textPrimary },
  when: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
});
