// Bottom-sheet showing recent notifications for this device. The
// stale-while-revalidate fetch logic lives in useDeviceNotifications — this
// file is just the render layer plus the context wiring that decides when
// the sheet is open and what to do on a row tap.

import { notificationBody } from '../../../../notification-copy';
import React from 'react';
import { colors, typography } from '../theme/tokens';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { CircleCheck, OctagonX, Star, TrendingUp, Zap } from 'lucide-react-native';
import { useDevice } from '../context/DeviceContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { useDeviceNotifications } from '../hooks/useDeviceNotifications';
import { NotificationLogEntry } from '../types';
import { formatTimeAgo } from '../timestamp';
import { Sheet } from './Sheet';

export function NotificationHistorySheet(): React.ReactElement {
  const { deviceId } = useDevice();
  const { openDetail, historySheetOpen, closeHistorySheet } = useNotificationDetail();
  const { entries, refreshing, error } = useDeviceNotifications(
    deviceId ?? null,
    historySheetOpen,
  );

  return (
    <Sheet
      isOpen={historySheetOpen}
      onClose={closeHistorySheet}
      size="tall"
      title="Recent notifications"
      testID="notif-history"
    >
      <BottomSheetFlatList
        data={entries ?? []}
        keyExtractor={e => `${e.rideId}-${e.type}-${e.firedAt}`}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Row
            entry={item}
            onPress={() => {
              openDetail({
                rideId: item.rideId,
                type: item.type,
                source: 'history',
                durationMs: item.durationMs ?? null,
                closedAt: item.closedAt ?? null,
              });
            }}
          />
        )}
        ListHeaderComponent={
          refreshing && entries && entries.length > 0 ? (
            <View style={styles.refreshRow} testID="notif-history-refreshing">
              <ActivityIndicator size="small" color={colors.textTertiary} />
              <Text style={styles.refreshText}>Updating…</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          error ? (
            <Text style={styles.error}>{error}</Text>
          ) : refreshing ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" />
            </View>
          ) : (
            <Text style={styles.empty}>No notifications in the last 2 hours.</Text>
          )
        }
        ListFooterComponent={
          <Text style={styles.footer}>Shows the last 2 hours of activity.</Text>
        }
      />
    </Sheet>
  );
}

function Row({
  entry,
  onPress,
}: {
  entry: NotificationLogEntry;
  onPress: () => void;
}): React.ReactElement {
  const isOpportunity = entry.type === 'reopen' && !!entry.isOpportunity;
  const icon = iconFor(entry);
  const body = entry.body ?? notificationBody(entry);
  const when = formatTimeAgo(entry.firedAt);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        isOpportunity && styles.rowOpportunity,
        pressed && styles.rowPressed,
      ]}
      testID={`notif-history-row-${entry.rideId}-${entry.type}`}
    >
      <View style={styles.iconCell}>{icon}</View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{entry.rideName ?? 'Ride'}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <Text style={styles.when}>{when}</Text>
    </Pressable>
  );
}

function iconFor(entry: NotificationLogEntry): React.ReactElement {
  if (entry.type === 'closure') return <OctagonX size={18} color={colors.skip} />;
  if (entry.type === 'peak')    return <TrendingUp size={18} color={colors.skip} />;
  if (entry.type === 'reopen' && entry.isOpportunity) return <Zap size={18} color={colors.go} />;
  if (entry.type === 'reopen')  return <CircleCheck size={18} color={colors.go} />;
  if (entry.badge === 'star')   return <Star size={18} color={colors.star} fill={colors.star} />;
  return <CircleCheck size={18} color={colors.go} />;
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 16, flexGrow: 1 },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  refreshText: { fontSize: 12, color: colors.textTertiary },
  loading: { paddingVertical: 24, alignItems: 'center' },
  error: { color: colors.skip, fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  empty: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  rowOpportunity: { backgroundColor: colors.opportunityCardBg },
  rowPressed: { backgroundColor: colors.goBg },
  iconCell: { marginRight: 10, marginTop: 1, width: 20, alignItems: 'center' },
  rowText: { flex: 1, paddingRight: 8 },
  rowTitle: { ...typography.label, color: colors.textPrimary },
  rowBody: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  when: { ...typography.caption, color: colors.textTertiary, marginTop: 3 },
  footer: { fontSize: 11, color: colors.textTertiary, marginTop: 14, textAlign: 'center' },
});
