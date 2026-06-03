// Bottom-sheet modal showing recent notifications for this device.
//
// Stale-while-revalidate: on open we immediately show the cached list from
// AsyncStorage, then fetch fresh data in the background. A small loading
// indicator at the top of the list signals the refresh without replacing the
// content — so the user sees something instantly and isn't surprised by new
// entries appearing.
//
// Each row recomposes a tight summary from the log entry's data rather
// than persisting the OS-notification body verbatim. Tradeoff: if we
// later improve message wording the history reflects the new wording
// automatically.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDevice } from '../context/DeviceContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { ApiError, fetchDeviceNotifications } from '../api';
import { NotificationLogEntry } from '../types';
import { formatTimeAgo } from '../timestamp';
import { getCachedNotifications, setCachedNotifications } from '../utils/notificationHistoryStorage';

export function NotificationHistorySheet(): React.ReactElement {
  const { deviceId } = useDevice();
  const { openDetail, historySheetOpen, closeHistorySheet } = useNotificationDetail();
  const visible = historySheetOpen;
  const onClose = closeHistorySheet;
  const [entries, setEntries] = useState<NotificationLogEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!deviceId) return;

    // Show cached entries immediately so the sheet isn't blank while we fetch.
    const cached = await getCachedNotifications(deviceId);
    if (cached) setEntries(cached);

    // Fetch fresh data in the background; a small indicator in the list header
    // signals the update without replacing the visible content.
    setRefreshing(true);
    setError(null);
    try {
      const next = await fetchDeviceNotifications(deviceId);
      setEntries(next);
      void setCachedNotifications(deviceId, next);
    } catch (err) {
      // Only surface the error if we have nothing to show.
      if (!cached) {
        const message = err instanceof ApiError ? err.message : 'Could not load notifications';
        setError(message);
      }
    } finally {
      setRefreshing(false);
    }
  }, [deviceId]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} testID="notif-history-backdrop" />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Recent notifications</Text>
            <Pressable onPress={onClose} hitSlop={12} testID="notif-history-close">
              <Text style={styles.closeX}>✕</Text>
            </Pressable>
          </View>
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
                    // openDetail closes the sheet automatically. The detail
                    // modal's "Back" button restores it because we pass
                    // source: 'history'.
                    openDetail({ rideId: item.rideId, type: item.type, source: 'history' });
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
              style={styles.list}
            />
          ) : refreshing ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" />
            </View>
          ) : (
            <Text style={styles.empty}>No notifications in the last 2 hours.</Text>
          )}
          <Text style={styles.footer}>Shows the last 2 hours of activity.</Text>
        </View>
      </View>
    </Modal>
  );
}

function Row({
  entry,
  onPress,
}: {
  entry: NotificationLogEntry;
  onPress: () => void;
}): React.ReactElement {
  const emoji = emojiFor(entry);
  const body = summarize(entry);
  const when = formatTimeAgo(entry.firedAt);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`notif-history-row-${entry.rideId}-${entry.type}`}
    >
      <Text style={styles.emoji}>{emoji}</Text>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{entry.rideName ?? 'Ride'}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <Text style={styles.when}>{when}</Text>
    </Pressable>
  );
}

function emojiFor(entry: NotificationLogEntry): string {
  if (entry.type === 'closure') return '🛑';
  if (entry.type === 'reopen') return '🎉';
  if (entry.type === 'peak') return '✕';
  return entry.badge === 'star' ? '⭐' : '✅';
}

function summarize(entry: NotificationLogEntry): string {
  if (entry.type === 'trough') {
    const wait = entry.currentWait != null ? `${entry.currentWait} min` : 'a short wait';
    const compare = entry.bucket0Wait != null ? `, usually ${entry.bucket0Wait}` : '';
    if (entry.badge === 'star') return `Just ${wait}${compare}. Rare low.`;
    return `Only ${wait}${compare}.`;
  }
  if (entry.type === 'closure') {
    return 'Just went down.';
  }
  if (entry.type === 'reopen') {
    const wait = entry.currentWait != null ? `${entry.currentWait} min` : null;
    const downtime = entry.durationMs != null ? formatShortDuration(entry.durationMs) : null;
    if (downtime && wait) return `Back after ${downtime}. Wait posted at ${wait}.`;
    if (downtime) return `Back after ${downtime}.`;
    if (wait) return `Just reopened. Wait posted at ${wait}.`;
    return 'Just reopened.';
  }
  if (entry.type === 'peak') {
    const wait = entry.currentWait != null ? `${entry.currentWait} min` : 'a long wait';
    const p90 = entry.rideStats?.p90 != null ? ` — p90 is ${entry.rideStats.p90}` : '';
    return `At ${wait}${p90}. Now's not the time.`;
  }
  return '';
}

function formatShortDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 1.25) return 'an hour';
  if (hours < 10) return `${Math.round(hours * 10) / 10} hours`;
  return `${Math.round(hours)} hours`;
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
    // Most of the screen, but leave a peek of the underlying page at top
    // so the user still recognizes this as a dismissable sheet.
    height: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222' },
  closeX: { fontSize: 22, color: '#999' },
  list: { flexGrow: 0 },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  refreshText: { fontSize: 12, color: '#999' },
  loading: { paddingVertical: 24, alignItems: 'center' },
  error: { color: '#c41e3a', fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  empty: { color: '#888', fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
  },
  rowPressed: { backgroundColor: '#f4f4ff' },
  emoji: { fontSize: 18, marginRight: 10, marginTop: 1 },
  rowText: { flex: 1, paddingRight: 8 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#222' },
  rowBody: { fontSize: 13, color: '#444', marginTop: 2 },
  when: { fontSize: 11, color: '#888', marginTop: 3 },
  footer: { fontSize: 11, color: '#888', marginTop: 14, textAlign: 'center' },
});
