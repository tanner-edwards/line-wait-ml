// Single-notification detail modal. Shows the ride + why-fired + current
// state. Opened from a history-sheet row tap (G2a) or a service worker
// deep-link (G2b — sw.js notificationclick posts a message we listen
// for at the app root).
//
// Data sources:
//   • Ride name, current wait, status — RideContext (live data)
//   • Why-fired summary — re-derived from active.type + ride data
//
// If the ride is missing from live data (e.g., ride no longer in the
// snapshot), we degrade gracefully with just the ride id + type.

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { useRides } from '../context/RideContext';
import { NotificationKind } from '../types';

export function NotificationDetailModal(): React.ReactElement {
  const { active, closeDetail } = useNotificationDetail();
  const { ridesById } = useRides();
  const ride = active ? ridesById.get(active.rideId) ?? null : null;

  const visible = active !== null;
  const type = active?.type;
  const rideName = ride?.name ?? 'Ride';
  const emoji = type ? emojiFor(type, null) : '';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={closeDetail}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={closeDetail} testID="notif-detail-backdrop" />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {emoji} {rideName}
            </Text>
            <Pressable onPress={closeDetail} hitSlop={12} testID="notif-detail-close">
              <Text style={styles.closeX}>✕</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            {type && ride ? (
              <DetailBody type={type} ride={ride} />
            ) : type ? (
              <Text style={styles.fallback}>
                That ride isn't in the current snapshot. Check the Browse tab for the latest status.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailBody({
  type,
  ride,
}: {
  type: NotificationKind;
  ride: { name: string; status: string; currentWait: number | null; closedAt?: string | null };
}): React.ReactElement {
  const status = ride.status;
  const isOperating = status === 'OPERATING';

  return (
    <>
      <Text style={styles.sectionLabel}>Why we sent this</Text>
      <Text style={styles.sectionBody}>{whyText(type)}</Text>

      <Text style={styles.sectionLabel}>Right now</Text>
      <View style={styles.statusRow}>
        <Text style={[styles.statusPill, isOperating ? styles.statusOpen : styles.statusClosed]}>
          {isOperating ? 'Operating' : status === 'DOWN' ? 'Down' : status}
        </Text>
        {isOperating && ride.currentWait !== null ? (
          <Text style={styles.waitNumber}>{ride.currentWait} min wait</Text>
        ) : null}
      </View>
      {status === 'DOWN' && ride.closedAt ? (
        <Text style={styles.closedHint}>Closed since {formatTime(ride.closedAt)}.</Text>
      ) : null}
    </>
  );
}

function whyText(type: NotificationKind): string {
  if (type === 'trough') return "This ride hit a short-wait window worth checking out.";
  if (type === 'closure') return 'This ride went down. Worth pivoting if you were headed there.';
  if (type === 'reopen') return 'This ride is back up — crowds usually take a few minutes to catch on.';
  return '';
}

function emojiFor(type: NotificationKind, badge: 'star' | 'go' | null): string {
  if (type === 'closure') return '🛑';
  if (type === 'reopen') return '🎉';
  return badge === 'star' ? '⭐' : '✅';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const h = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `${h}:${mm} ${ampm}`;
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
  title: { fontSize: 18, fontWeight: '700', color: '#222', flex: 1, paddingRight: 12 },
  closeX: { fontSize: 22, color: '#999' },
  body: { paddingBottom: 12 },
  sectionLabel: {
    fontSize: 11,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 4,
  },
  sectionBody: { fontSize: 14, color: '#222', lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  statusPill: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    marginRight: 10,
  },
  statusOpen: { backgroundColor: '#e6f7e9', color: '#2a8f3e' },
  statusClosed: { backgroundColor: '#fde2e2', color: '#7a1f1f' },
  waitNumber: { fontSize: 16, fontWeight: '700', color: '#222' },
  closedHint: { fontSize: 12, color: '#7a1f1f', marginTop: 6 },
  fallback: { fontSize: 14, color: '#666', textAlign: 'center', paddingVertical: 24 },
});
