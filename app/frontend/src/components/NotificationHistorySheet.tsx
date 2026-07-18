// Bottom-sheet showing recent notifications for this device. The
// stale-while-revalidate fetch logic lives in useDeviceNotifications — this
// file is just the render layer plus the context wiring that decides when
// the sheet is open and what to do on a row tap.

import { notificationBody } from '../../../../notification-copy';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { colors, typography } from '../theme/tokens';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { CircleCheck, OctagonX, Star, TrendingUp, X, Zap } from 'lucide-react-native';
import { useDevice } from '../context/DeviceContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { useDeviceNotifications } from '../hooks/useDeviceNotifications';
import { NotificationCategory, NotificationLogEntry } from '../types';
import { formatTimeAgo } from '../timestamp';
import { Sheet } from './Sheet';

// --- Filter chip definitions ---

type ChipDef = { key: NotificationCategory; label: string };

const CHIPS: ChipDef[] = [
  { key: 'trough',     label: 'Short Waits' },
  { key: 'peak',       label: 'Long Waits'  },
  { key: 'rare-find',  label: 'Rare Find'   },
  { key: 'closure',    label: 'Closures'    },
  { key: 'reopen',     label: 'Reopened'    },
];

function matchesFilter(entry: NotificationLogEntry, active: Set<NotificationCategory>): boolean {
  if (active.size === 0) return true;
  if (active.has('rare-find') && entry.type === 'trough' && entry.badge === 'star') return true;
  if (active.has('trough')    && entry.type === 'trough')   return true;
  if (active.has('peak')      && entry.type === 'peak')     return true;
  if (active.has('closure')   && entry.type === 'closure')  return true;
  if (active.has('reopen')    && entry.type === 'reopen')   return true;
  return false;
}

// --- Main component ---

export function NotificationHistorySheet(): React.ReactElement {
  const { deviceId } = useDevice();
  const { openDetail, historySheetOpen, historySheetPreFilter, closeHistorySheet } = useNotificationDetail();
  const { entries, refreshing, error } = useDeviceNotifications(
    deviceId ?? null,
    historySheetOpen,
  );

  // Active filter chips — seeded from context pre-filter when sheet opens.
  const [activeChips, setActiveChips] = useState<Set<NotificationCategory>>(new Set());
  useEffect(() => {
    if (historySheetOpen) {
      setActiveChips(historySheetPreFilter ? new Set([historySheetPreFilter]) : new Set());
    }
  }, [historySheetOpen, historySheetPreFilter]);

  const toggleChip = useCallback((key: NotificationCategory) => {
    setActiveChips(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearChips = useCallback(() => setActiveChips(new Set()), []);

  const filteredEntries = useMemo(() => {
    if (!entries) return null;
    if (activeChips.size === 0) return entries;
    return entries.filter(e => matchesFilter(e, activeChips));
  }, [entries, activeChips]);

  const statusLabel = useMemo(() => {
    if (activeChips.size === 0) return 'Showing everything';
    if (activeChips.size === 1) {
      const key = [...activeChips][0];
      const chip = CHIPS.find(c => c.key === key);
      return `Showing: ${chip?.label ?? key}`;
    }
    return `Showing ${activeChips.size} filters`;
  }, [activeChips]);

  const renderHeader = useCallback(() => (
    <View>
      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {CHIPS.map(chip => {
          const active = activeChips.has(chip.key);
          return (
            <Pressable
              key={chip.key}
              onPress={() => toggleChip(chip.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Status row */}
      <View style={styles.statusRow}>
        <Text style={styles.statusText}>{statusLabel}</Text>
        {activeChips.size > 0 ? (
          <Pressable onPress={clearChips} style={styles.clearBtn} hitSlop={8}>
            <X size={11} color={colors.skip} />
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Refresh indicator (when reloading with existing entries) */}
      {refreshing && entries && entries.length > 0 ? (
        <View style={styles.refreshRow} testID="notif-history-refreshing">
          <ActivityIndicator size="small" color={colors.textTertiary} />
          <Text style={styles.refreshText}>Updating…</Text>
        </View>
      ) : null}
    </View>
  ), [activeChips, statusLabel, toggleChip, clearChips, refreshing, entries]);

  return (
    <Sheet
      isOpen={historySheetOpen}
      onClose={closeHistorySheet}
      size="tall"
      title="Recent notifications"
      testID="notif-history"
    >
      <BottomSheetFlatList
        data={filteredEntries ?? []}
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
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          error ? (
            <Text style={styles.error}>{error}</Text>
          ) : refreshing ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" />
            </View>
          ) : (
            <Text style={styles.empty}>
              {activeChips.size > 0
                ? 'No notifications match this filter.'
                : 'No notifications in the last 2 hours.'}
            </Text>
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

  // Filter chips
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.textInverse,
  },

  // Status row
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  statusText: {
    fontSize: 11,
    color: colors.textTertiary,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clearText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.skip,
  },

  // Refresh indicator
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

  // Notification rows (card layout)
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  rowOpportunity: {
    backgroundColor: colors.opportunityCardBg,
    borderColor: colors.opportunityCardBorder,
  },
  rowPressed: { backgroundColor: colors.goBg },
  iconCell: { marginRight: 10, marginTop: 1, width: 20, alignItems: 'center' },
  rowText: { flex: 1, paddingRight: 8 },
  rowTitle: { ...typography.label, color: colors.textPrimary },
  rowBody: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  when: { ...typography.caption, color: colors.textTertiary, marginTop: 3 },

  footer: { fontSize: 11, color: colors.textTertiary, marginTop: 14, textAlign: 'center' },
});
