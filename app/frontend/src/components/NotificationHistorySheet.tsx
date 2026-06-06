// Bottom-sheet showing recent notifications for this device.
//
// Stale-while-revalidate: on open we immediately show the cached list from
// AsyncStorage, then fetch fresh data in the background. A small loading
// indicator at the top of the list signals the refresh without replacing the
// content — so the user sees something instantly and isn't surprised by new
// entries appearing.
//
// Each row recomposes a tight summary from the log entry's data rather than
// persisting the OS-notification body verbatim. Tradeoff: if we later improve
// message wording the history reflects the new wording automatically.

import { notificationBody } from '../../../../notification-copy';
import React, { useCallback, useEffect, useState } from 'react';
import { colors } from '../theme/tokens';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CircleCheck, OctagonX, Star } from 'lucide-react-native';
import { useDevice } from '../context/DeviceContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { ApiError, fetchDeviceNotifications } from '../api';
import { NotificationLogEntry } from '../types';
import { formatTimeAgo } from '../timestamp';
import { getCachedNotifications, setCachedNotifications } from '../utils/notificationHistoryStorage';
import { Sheet } from './Sheet';

export function NotificationHistorySheet(): React.ReactElement {
  const { deviceId } = useDevice();
  const { openDetail, historySheetOpen, closeHistorySheet } = useNotificationDetail();
  const [entries, setEntries] = useState<NotificationLogEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!deviceId) return;

    const cached = await getCachedNotifications(deviceId);
    if (cached) setEntries(cached);

    setRefreshing(true);
    setError(null);
    try {
      const next = await fetchDeviceNotifications(deviceId);
      setEntries(next);
      void setCachedNotifications(deviceId, next);
    } catch (err) {
      if (!cached) {
        const message = err instanceof ApiError ? err.message : 'Could not load notifications';
        setError(message);
      }
    } finally {
      setRefreshing(false);
    }
  }, [deviceId]);

  useEffect(() => {
    if (historySheetOpen) void load();
  }, [historySheetOpen, load]);

  return (
    <Sheet
      isOpen={historySheetOpen}
      onClose={closeHistorySheet}
      size="tall"
      title="Recent notifications"
      testID="notif-history"
    >
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : entries && entries.length > 0 ? (
        <FlatList
          data={entries}
          keyExtractor={e => `${e.rideId}-${e.type}-${e.firedAt}`}
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
            refreshing ? (
              <View style={styles.refreshRow} testID="notif-history-refreshing">
                <ActivityIndicator size="small" color="#999" />
                <Text style={styles.refreshText}>Updating…</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            <Text style={styles.footer}>Shows the last 2 hours of activity.</Text>
          }
          style={styles.list}
        />
      ) : refreshing ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" />
        </View>
      ) : (
        <>
          <Text style={styles.empty}>No notifications in the last 2 hours.</Text>
          <Text style={styles.footer}>Shows the last 2 hours of activity.</Text>
        </>
      )}
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
  const icon = iconFor(entry);
  const body = entry.body ?? notificationBody(entry);
  const when = formatTimeAgo(entry.firedAt);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
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
  if (entry.type === 'peak')    return <OctagonX size={18} color={colors.star} />;
  if (entry.type === 'reopen')  return <CircleCheck size={18} color={colors.go} />;
  if (entry.badge === 'star')   return <Star size={18} color={colors.star} fill={colors.star} />;
  return <CircleCheck size={18} color={colors.go} />;
}

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  refreshText: { fontSize: 12, color: '#999' }, // TODO: tokenize
  loading: { paddingVertical: 24, alignItems: 'center' },
  error: { color: colors.skip, fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  empty: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomColor: '#eee', // TODO: tokenize
    borderBottomWidth: 1,
  },
  rowPressed: { backgroundColor: '#f4f4ff' }, // TODO: tokenize
  iconCell: { marginRight: 10, marginTop: 1, width: 20, alignItems: 'center' },
  rowText: { flex: 1, paddingRight: 8 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#222' }, // TODO: tokenize
  rowBody: { fontSize: 13, color: '#444', marginTop: 2 }, // TODO: tokenize
  when: { fontSize: 11, color: colors.textTertiary, marginTop: 3 },
  footer: { fontSize: 11, color: colors.textTertiary, marginTop: 14, textAlign: 'center' },
});
