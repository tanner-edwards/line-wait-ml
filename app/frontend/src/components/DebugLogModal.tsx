// Full-screen debug log viewer, reachable from Profile when Debug mode is on.
//
// Reads the in-memory ring buffer from utils/logger and renders entries
// newest-first, updating live via useSyncExternalStore. Session-only — the
// buffer (and this list) reset on reload. A Clear button empties the buffer.

import React, { useSyncExternalStore } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LogEntry, LogLevel, clearLogs, getLogs, subscribeLogs } from '../utils/logger';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: '#666',
  warn: '#b8860b',
  error: '#c41e3a',
};

export function DebugLogModal({ visible, onClose }: Props): React.ReactElement {
  const logs = useSyncExternalStore(subscribeLogs, getLogs);
  // Newest first for reading.
  const ordered = [...logs].reverse();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.headerBar}>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            hitSlop={12}
            testID="debug-log-close"
          >
            <Text style={styles.backArrow}>‹ Back</Text>
          </Pressable>
          <Text style={styles.title}>Logs</Text>
          <Pressable
            onPress={clearLogs}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            hitSlop={12}
            testID="debug-log-clear"
          >
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        </View>
        {ordered.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.empty}>No logs yet. Reproduce the issue, then come back.</Text>
          </View>
        ) : (
          <FlatList
            data={ordered}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => <LogRow entry={item} />}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

function LogRow({ entry }: { entry: LogEntry }): React.ReactElement {
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={[styles.level, { color: LEVEL_COLOR[entry.level] }]}>
          {entry.level.toUpperCase()}
        </Text>
        {entry.tag ? <Text style={styles.tag}>{entry.tag}</Text> : null}
        <Text style={styles.time}>{formatClock(entry.ts)}</Text>
      </View>
      <Text style={styles.message} selectable>{entry.message}</Text>
    </View>
  );
}

function formatClock(iso: string): string {
  // HH:MM:SS in local time; falls back to the raw ISO if parsing fails.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
  },
  headerButton: { paddingVertical: 6, minWidth: 56 },
  pressed: { opacity: 0.5 },
  backArrow: { fontSize: 16, color: '#4a4ec7', fontWeight: '600' },
  title: { fontSize: 16, fontWeight: '700', color: '#222' },
  clear: { fontSize: 16, color: '#c41e3a', fontWeight: '600', textAlign: 'right' },
  emptyBlock: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  empty: { fontSize: 14, color: '#888', textAlign: 'center' },
  list: { padding: 12 },
  row: {
    paddingVertical: 8,
    borderBottomColor: '#f0f0f0',
    borderBottomWidth: 1,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  level: { fontSize: 11, fontWeight: '700', marginRight: 8 },
  tag: {
    fontSize: 11,
    color: '#555',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 8,
    overflow: 'hidden',
  },
  time: { fontSize: 11, color: '#999', marginLeft: 'auto' },
  message: { fontSize: 13, color: '#222', fontFamily: 'Courier', lineHeight: 18 },
});
