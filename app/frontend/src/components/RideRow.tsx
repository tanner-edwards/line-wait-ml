// Row item for the Discover list. White rows with inset dividers, not
// individual cards — 30+ items, density matters. Same shape as
// RecommendationCard, minus the AI copy:
//
// [Ride icon]  Ride name [🔔]                                       [›]
//              [✓ GO FOR IT]  N min wait | Walk On | Down | Closed   [🚶 N min]
//                                               (walk pill right-aligned)
//              Down since 2:15 PM (20m ago)   (Down only)
//
// ONE good/bad signal: the verdict badge (Neutral = no badge). The wait is a
// neutral fact — never colored (Walk On is the one green exception).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, ChevronRight, Footprints } from 'lucide-react-native';
import { Ride } from '../types';
import { colors, spacing, typography } from '../theme/tokens';
import { VerdictBadge } from './VerdictBadge';
import { WalkPill } from './WalkPill';
import { WaitPill } from './WaitPill';
import { RideIcon } from './icons/RideIcon';
import { isWalkOnRide } from '../utils/walkOn';
import { rideWaitLabel, walkMinsTo } from '../grouping';
import { formatHHMM, formatTimeAgo } from '../timestamp';
import { useTrip } from '../context/TripContext';

const ICON_SIZE = 52;

interface RideRowProps {
  ride: Ride;
  walkOrigin: { lat: number; lng: number } | null;
  isWatching: boolean;
  onPress: () => void;
}

export function RideRow({ ride, walkOrigin, isWatching, onPress }: RideRowProps): React.ReactElement {
  const isOperating = ride.status === 'OPERATING';
  const isDown = ride.status === 'DOWN';
  const { hasActiveTrip } = useTrip();
  // Badge = the authoritative two-layer verdict (neutral → no chip).
  const rawVerdict = ride.verdict?.verdict ?? null;
  const rawBadge = rawVerdict && rawVerdict !== 'neutral' ? rawVerdict : null;
  const badge = !hasActiveTrip && rawBadge === 'star' ? 'go' : rawBadge;
  // "Walk On" is the wait-value relabel, not a verdict — independent of the
  // badge. A walk-on ride still shows its real badge (or none).
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait);
  const walkMins = walkOrigin ? walkMinsTo(walkOrigin, ride) : null;

  // Waits (incl. Walk On / No posted wait) get the white pill; Down / Closed /
  // Refurbishment are statuses and stay plain text.
  const status = walkOn ? (
    <WaitPill style={styles.waitShrink} testID="badge-walk-on">
      <Footprints size={13} color={colors.go} />
      <Text style={[styles.statusText, styles.walkOnText]}>Walk On</Text>
    </WaitPill>
  ) : isOperating && ride.currentWait !== null ? (
    <WaitPill style={styles.waitShrink}>
      <Text numberOfLines={1} style={styles.statusText}>{`${ride.currentWait} min wait`}</Text>
    </WaitPill>
  ) : isDown ? (
    <Text style={[styles.statusText, styles.downText]}>Down</Text>
  ) : isOperating ? (
    <WaitPill style={styles.waitShrink}>
      <Text numberOfLines={1} style={[styles.statusText, styles.mutedText]}>{rideWaitLabel(ride)}</Text>
    </WaitPill>
  ) : (
    <Text style={[styles.statusText, styles.mutedText]}>{rideWaitLabel(ride)}</Text>
  );

  return (
    <Pressable onPress={onPress} style={styles.pressable} testID={`ride-${ride.id}`}>
      <View style={styles.row}>
        <RideIcon rideId={ride.id} rideName={ride.name} size={ICON_SIZE} />
        <View style={styles.content}>
          <View style={styles.nameRow}>
            <Text style={[styles.rideName, !isOperating && styles.rideNameDown]}>{ride.name}</Text>
            {isWatching && hasActiveTrip ? <Bell size={12} color={colors.star} /> : null}
          </View>
          <View style={styles.metaRow}>
            {badge ? <VerdictBadge variant={badge} /> : null}
            {status}
            {walkMins != null ? (
              <View style={styles.walkEnd}>
                <WalkPill minutes={walkMins} />
              </View>
            ) : null}
          </View>
          {isDown && ride.closedAt ? (
            <Text style={styles.closedSince}>
              Down since {formatHHMM(ride.closedAt)} ({formatTimeAgo(ride.closedAt)})
            </Text>
          ) : null}
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // White full-bleed band; the row inside is inset so the divider is too.
  pressable: { backgroundColor: colors.surface },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.base,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  content: { flex: 1 },
  // Pushes the walk pill to the right edge of the text column, which ends
  // where the chevron's gap begins. Never shrinks — the status gives way.
  walkEnd: { marginLeft: 'auto', flexShrink: 0 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rideName: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  rideNameDown: {
    color: colors.textTertiary,
  },
  // Single line — the walk pill never wraps below the badge.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.md,
    marginTop: spacing.xs,
  },
  statusText: {
    ...typography.label,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  waitShrink: { flexShrink: 1 },
  walkOnText: { color: colors.go },
  downText: { color: colors.star },
  mutedText: { color: colors.textSecondary, fontWeight: '500' },
  closedSince: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
});
