// Compact row item for the Home / Live Waits list.
// Rows with dividers, not individual cards — 30+ items, density matters.
//
// Row 1: [Badge?] Ride name (flex)   [WalkOn OR Wait + min] [›]
// Row 2: [~X min walk pill]          [Trend label + TrendArrow]
//
// Badge precedence (mutually exclusive, highest wins):
//   star > walkOn > go > skip
// WalkOn replaces the wait number when it applies (and the ride isn't a star).
// Status color on the wait number only: go=below-normal, skip=above-normal.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, ChevronRight, Footprints } from 'lucide-react-native';
import { Ride } from '../types';
import { colors, spacing, typography } from '../theme/tokens';
import { Pill } from './Pill';
import { WalkPill } from './WalkPill';
import { BelowNormalBadge } from './BelowNormalBadge';
import { TrendArrow } from './TrendArrow';
import { isWalkOnRide } from '../utils/walkOn';
import { trendDirection } from '../utils/trendDirection';
import { haversineMeters, rideWaitLabel } from '../grouping';
import { formatHHMM, formatTimeAgo } from '../timestamp';
import { MIN_BUCKET_SAMPLE_COUNT } from '../scoreConstants';
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

const TREND_LABEL = { down: 'Dropping', up: 'Rising', stable: 'Steady' } as const;

export function RideRow({ ride, walkOrigin, isWatching, onPress }: RideRowProps): React.ReactElement {
  const isOperating = ride.status === 'OPERATING';
  const isDown = ride.status === 'DOWN';
  const ha = ride.historicalAverage;
  // When ML predictions are present, historicalBaseline holds the real
  // historical averages; bucket0 from primary would be currentWait.
  const bucket0 = (ride.historicalBaseline?.buckets[0] ?? ha?.buckets[0]) ?? null;
  const bucket1 = ha?.buckets[1] ?? null;
  const bucket3 = ha?.buckets[3] ?? null;
  const bucket4 = ha?.buckets[4] ?? null;
  const { hasActiveTrip } = useTrip();
  const rawBadge = ride.score?.badge ?? null;
  const badge = !hasActiveTrip && rawBadge === 'star' ? 'go' : rawBadge;
  const lowConfidence = (bucket0?.sampleCount ?? 0) < MIN_BUCKET_SAMPLE_COUNT;
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait);
  const walkMins = walkOrigin ? walkMinsTo(walkOrigin, ride) : null;

  // Trend combines real recent past observations with the historical-average
  // future curve. recentHistory is most-recent-first; we use [0] as the
  // last real datapoint. Past + future deltas summed, ±5 min threshold.
  const trendInput = {
    currentWait: ride.currentWait,
    recentWait: ride.recentHistory?.[0]?.wait ?? null,
    bucket1Wait: bucket1?.wait ?? null,
    bucket3Wait: bucket3?.wait ?? null,
    bucket4Wait: bucket4?.wait ?? null,
  };
  const trend = trendDirection(trendInput);

  // Badge precedence: star > walkOn > go > skip. Walk On beats go/skip
  // (a walk-on IS the truest "go"), but a star always wins.
  const showWalkOn = walkOn && badge !== 'star';
  const showBadge = badge !== null && !showWalkOn;

  const isBelowNormal =
    isOperating && ride.currentWait !== null && bucket0?.wait != null &&
    bucket0.wait > 0 && (bucket0.sampleCount ?? 0) >= MIN_BUCKET_SAMPLE_COUNT &&
    ride.currentWait < bucket0.wait * 0.75;
  const isAboveNormal =
    isOperating && ride.currentWait !== null && bucket0?.wait != null &&
    bucket0.wait > 0 && (bucket0.sampleCount ?? 0) >= MIN_BUCKET_SAMPLE_COUNT &&
    ride.currentWait > bucket0.wait * 1.25;

  const waitColor = isBelowNormal ? colors.go : isAboveNormal ? colors.skip : colors.textPrimary;

  const showRow2 = walkMins != null || trend !== null;

  return (
    <Pressable
      onPress={onPress}
      testID={`ride-${ride.id}`}
    >
      <View style={[styles.row, !isOperating && styles.rowDown]}>
        {/* Row 1 */}
        <View style={styles.row1}>
          {/* Badge — left of name (star/go/skip only; walkOn handled on right) */}
          {showBadge && <Pill variant={badge!} />}

          {/* Name + optional bell */}
          <View style={styles.nameRow}>
            <Text style={[styles.rideName, !isOperating && styles.rideNameDown]}>{ride.name}</Text>
            {isWatching && hasActiveTrip && <Bell size={12} color={colors.star} />}
          </View>

          {/* Right side: Walk On OR wait number */}
          <View style={styles.waitCluster}>
            {showWalkOn ? (
              <View style={styles.walkOnCluster} testID="badge-walk-on">
                <Footprints size={14} color={colors.go} />
                <Text style={[styles.walkOnLabel, { color: colors.go }]}>Walk On</Text>
              </View>
            ) : isOperating && ride.currentWait !== null ? (
              <>
                <Text style={[styles.waitNumber, { color: waitColor }]}>
                  {ride.currentWait}
                </Text>
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
              {badge === null ? (
                <BelowNormalBadge
                  currentWait={ride.currentWait}
                  bucket0Wait={bucket0?.wait ?? null}
                  sampleCount={bucket0?.sampleCount ?? 0}
                />
              ) : null}
            </View>
            <View style={styles.trendRow}>
              {trend ? <Text style={styles.trendLabel}>{TREND_LABEL[trend]}</Text> : null}
              {bucket0?.wait != null && bucket4?.wait != null ? (
                <TrendArrow
                  {...trendInput}
                  lowConfidence={lowConfidence}
                />
              ) : null}
            </View>
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
  closedLabel: {
    ...typography.label,
    fontSize: 14,
    color: colors.textTertiary,
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
