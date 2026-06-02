// Bottom-sheet modal showing recent notifications for this device.
// Fetches /v1/devices/:id/notifications on every open (no caching —
// the list is small and freshness matters more than network savings).
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

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function NotificationHistorySheet({ visible, onClose }: Props): React.ReactElement {
  const { deviceId } = useDevice();
  const { openDetail } = useNotificationDetail();
  const [entries, setEntries] = useState<NotificationLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchDeviceNotifications(deviceId);
      setEntries(next);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not load notifications';
      setError(message);
    } finally {
      setLoading(false);
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
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" />
            </View>
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : entries && entries.length > 0 ? (
            <FlatList
              data={entries}
              keyExtractor={e => `${e.rideId}-${e.type}-${e.firedAt}`}
              renderItem={({ item }) => (
                <Row
                  entry={item}
                  onPress={() => {
                    openDetail({ rideId: item.rideId, type: item.type });
                    onClose();
                  }}
                />
              )}
              style={styles.list}
            />
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
    return entry.previousWait != null
      ? `Just went down — was ${entry.previousWait} min.`
      : 'Just went down.';
  }
  if (entry.type === 'reopen') {
    const wait = entry.currentWait != null ? `${entry.currentWait} min` : null;
    const downtime = entry.durationMs != null ? formatShortDuration(entry.durationMs) : null;
    if (downtime && wait) return `Back after ${downtime}. Wait posted at ${wait}.`;
    if (downtime) return `Back after ${downtime}.`;
    if (wait) return `Just reopened. Wait posted at ${wait}.`;
    return 'Just reopened.';
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
    maxHeight: '70%',
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
