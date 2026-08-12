// Compact row item for the Home / Live Waits list.
// Rows with dividers, not individual cards — 30+ items, density matters.
//
// Row 1: [Verdict chip?] Ride name (flex)   [WalkOn OR Wait + min] [›]
// Row 2: [~X min walk pill]                  [Rising/Dropping + arrow]
//
// ONE good/bad signal: the verdict chip (star > walkOn > go > skip; Neutral =
// no chip). The wait number is a neutral fact — never colored. The trend is
// secondary context sourced from the server verdict's trajectory; Rising and
// Dropping only, Steady is suppressed.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, ChevronRight, Footprints } from 'lucide-react-native';
import { Ride } from '../types';
import { colors, spacing, typography } from '../theme/tokens';
import { Pill } from './Pill';
import { WalkPill } from './WalkPill';
import { TrendArrow, trajectoryDirection, predictionTrajectory } from './TrendArrow';
import { isWalkOnRide } from '../utils/walkOn';
import { haversineMeters, rideWaitLabel } from '../grouping';
import { formatHHMM, formatTimeAgo } from '../timestamp';
import { useTrip } from '../context/TripContext';

interface RideRowProps {
  ride: Ride;
  walkOrigin: { lat: number; lng: number } | null;
  isWatching: boolean;
  onPress: () => void;
}

const WALK_SPEED_MPM = 83;
function walkPathMultiplier(m: number) {
  return m >= 640 ? 2.0 : m >= 366 ? 1.6 : 1.3;
}
function walkMinsTo(
  origin: { lat: number; lng: number },
  ride: { lat: number | null; lng: number | null }
): number | null {
  if (ride.lat == null || ride.lng == null) return null;
  const raw = haversineMeters(origin.lat, origin.lng, ride.lat, ride.lng);
  return Math.max(1, Math.round((raw * walkPathMultiplier(raw)) / WALK_SPEED_MPM));
}

const TREND_LABEL = { down: 'Dropping', up: 'Rising' } as const;

export function RideRow({ ride, walkOrigin, isWatching, onPress }: RideRowProps): React.ReactElement {
  const isOperating = ride.status === 'OPERATING';
  const isDown = ride.status === 'DOWN';
  const { hasActiveTrip } = useTrip();
  // Badge = the authoritative two-layer verdict (neutral → no chip).
  const rawVerdict = ride.verdict?.verdict ?? null;
  const rawBadge = rawVerdict && rawVerdict !== 'neutral' ? rawVerdict : null;
  const badge = !hasActiveTrip && rawBadge === 'star' ? 'go' : rawBadge;
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait);
  const walkMins = walkOrigin ? walkMinsTo(walkOrigin, ride) : null;

  // Trend — single source of truth is the server verdict's trajectory. No local
  // recompute; Steady / absent renders nothing.
  const trend = isOperating ? trajectoryDirection(predictionTrajectory(ride.prediction)) : null;

  // Badge precedence: star > walkOn > go > skip. Walk On beats go/skip
  // (a walk-on IS the truest "go"), but a star always wins.
  const showWalkOn = walkOn && badge !== 'star';
  const showBadge = badge !== null && !showWalkOn;

  const showRow2 = walkMins != null || trend !== null;

  return (
    <Pressable
      onPress={onPress}
      testID={`ride-${ride.id}`}
    >
      <View style={[styles.row, !isOperating && styles.rowDown]}>
        {/* Row 1 */}
        <View style={styles.row1}>
          {/* Verdict chip — left of name (star/go/skip only; walkOn handled on right) */}
          {showBadge && <Pill variant={badge!} />}

          {/* Name + optional bell */}
          <View style={styles.nameRow}>
            <Text style={[styles.rideName, !isOperating && styles.rideNameDown]}>{ride.name}</Text>
            {isWatching && hasActiveTrip && <Bell size={12} color={colors.star} />}
          </View>

          {/* Right side: Walk On OR wait number (neutral color — it's a fact) */}
          <View style={styles.waitCluster}>
            {showWalkOn ? (
              <View style={styles.walkOnCluster} testID="badge-walk-on">
                <Footprints size={14} color={colors.go} />
                <Text style={[styles.walkOnLabel, { color: colors.go }]}>Walk On</Text>
              </View>
            ) : isOperating && ride.currentWait !== null ? (
              <>
                <Text style={styles.waitNumber}>{ride.currentWait}</Text>
                <Text style={styles.waitMin}> min</Text>
              </>
            ) : isDown ? (
              <Text style={styles.downLabel}>Down</Text>
            ) : (
              <Text style={styles.waitStatus}>{rideWaitLabel(ride)}</Text>
            )}
            <ChevronRight size={13} color={colors.textTertiary} />
          </View>
        </View>

        {/* Row 2 — walk pill + trend */}
        {showRow2 ? (
          <View style={styles.row2}>
            <View style={styles.row2Left}>
              {walkMins != null ? <WalkPill minutes={walkMins} /> : null}
            </View>
            {trend ? (
              <View style={styles.trendRow}>
                <Text style={styles.trendLabel}>{TREND_LABEL[trend]}</Text>
                <TrendArrow direction={trend} />
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Closed-since line */}
        {isDown && ride.closedAt ? (
          <Text style={styles.closedSince}>
            Down since {formatHHMM(ride.closedAt)} ({formatTimeAgo(ride.closedAt)})
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.base,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowDown: {},
  row1: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginRight: spacing.sm,
  },
  rideName: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  rideNameDown: {
    color: colors.textTertiary,
  },
  waitCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  waitNumber: {
    ...typography.waitNumber,
    color: colors.textPrimary,
  },
  waitMin: {
    ...typography.label,
    color: colors.textSecondary,
    alignSelf: 'flex-end',
    paddingBottom: 2,
  },
  waitStatus: {
    ...typography.label,
    fontSize: 14,
    color: colors.textSecondary,
  },
  downLabel: {
    ...typography.label,
    fontSize: 14,
    color: colors.star,
  },
  walkOnCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  walkOnLabel: {
    ...typography.label,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  row2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  row2Left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginRight: 2,
  },
  closedSince: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
});
