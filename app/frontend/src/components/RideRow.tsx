// Row item for the Discover list. White rows with inset dividers, not
// individual cards — 30+ items, density matters. Same shape as
// RecommendationCard, minus the AI copy:
//
// [Ride icon]  [Verdict chip?] Ride name [🔔]        [›]
//              [~X min walk pill] · N min wait | Walk On | Down | Closed
//              Down since 2:15 PM (20m ago)   (Down only)
//
// ONE good/bad signal: the verdict chip (Neutral = no chip). The wait is a
// neutral fact — never colored. The trend label was dropped in the phase-3
// redesign (ride detail keeps it), matching the rec cards.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, ChevronRight, Footprints } from 'lucide-react-native';
import { Ride } from '../types';
import { colors, spacing, typography } from '../theme/tokens';
import { Pill } from './Pill';
import { WalkPill } from './WalkPill';
import { RideIcon } from './icons/RideIcon';
import { isWalkOnRide } from '../utils/walkOn';
import { rideWaitLabel, walkMinsTo } from '../grouping';
import { formatHHMM, formatTimeAgo } from '../timestamp';
import { useTrip } from '../context/TripContext';

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

  const status = walkOn ? (
    <View style={styles.walkOnCluster} testID="badge-walk-on">
      <Footprints size={13} color={colors.go} />
      <Text style={[styles.statusText, styles.walkOnText]}>Walk On</Text>
    </View>
  ) : isOperating && ride.currentWait !== null ? (
    <Text style={styles.statusText}>{`${ride.currentWait} min wait`}</Text>
  ) : isDown ? (
    <Text style={[styles.statusText, styles.downText]}>Down</Text>
  ) : (
    <Text style={[styles.statusText, styles.mutedText]}>{rideWaitLabel(ride)}</Text>
  );

  return (
    <Pressable onPress={onPress} style={styles.pressable} testID={`ride-${ride.id}`}>
      <View style={styles.row}>
        <RideIcon rideId={ride.id} size={44} />
        <View style={styles.content}>
          <View style={styles.nameRow}>
            {badge ? <Pill variant={badge} /> : null}
            <Text style={[styles.rideName, !isOperating && styles.rideNameDown]}>{ride.name}</Text>
            {isWatching && hasActiveTrip ? <Bell size={12} color={colors.star} /> : null}
          </View>
          <View style={styles.metaRow}>
            {walkMins != null ? <WalkPill minutes={walkMins} emphasized /> : null}
            {walkMins != null ? <Text style={styles.metaDot}>·</Text> : null}
            {status}
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  metaDot: {
    ...typography.label,
    color: colors.textTertiary,
  },
  statusText: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  walkOnCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  walkOnText: { color: colors.go },
  downText: { color: colors.star },
  mutedText: { color: colors.textSecondary, fontWeight: '500' },
  closedSince: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
});
