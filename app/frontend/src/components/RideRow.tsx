// Compact row item for the Home / Live Waits list.
// Rows with dividers, not individual cards — 30+ items, density matters.
//
// Row 1: [Badge?] Ride name (flex)   [WalkOn OR Wait + min] [›]
// Row 2: [~X min walk pill]          [Trend label + TrendArrow]
//
// Badge precedence (mutually exclusive, highest wins):
//   star > go > skip > walkOn (lowest — never shown alongside a badge)
// WalkOn replaces the wait number when it applies and no badge is present.
// Status color on the wait number only: go=below-normal, skip=above-normal.

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, ChevronRight, Footprints, Navigation2 } from 'lucide-react-native';
import { Ride } from '../types';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { Pill } from './Pill';
import { TrendArrow } from './TrendArrow';
import { isWalkOnRide } from '../utils/walkOn';
import { haversineMeters, rideWaitLabel } from '../grouping';
import { formatHHMM, formatTimeAgo } from '../timestamp';
import { usePersona } from '../context/PersonaContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';

interface RideRowProps {
  ride: Ride;
  walkOrigin: { lat: number; lng: number } | null;
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
function trendDir(b0: number | null, b4: number | null): 'down' | 'up' | 'stable' | null {
  if (!b0 || !b4 || b0 === 0) return null;
  if (b4 < b0 * 0.9) return 'down';
  if (b4 > b0 * 1.1) return 'up';
  return 'stable';
}

export function RideRow({ ride, walkOrigin }: RideRowProps): React.ReactElement {
  const { persona } = usePersona();
  const { openDetail } = useNotificationDetail();

  const isWatching = useMemo(
    () => persona?.mustDoRideIds.includes(ride.id) ?? false,
    [persona, ride.id]
  );

  const isOperating = ride.status === 'OPERATING';
  const isDown = ride.status === 'DOWN';
  const ha = ride.historicalAverage;
  const bucket0 = ha?.buckets[0] ?? null;
  const bucket4 = ha?.buckets[4] ?? null;
  const badge = ride.score?.badge ?? null;
  const lowConfidence = (bucket0?.sampleCount ?? 0) < 1;
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait);
  const walkMins = walkOrigin ? walkMinsTo(walkOrigin, ride) : null;
  const trend = trendDir(bucket0?.wait ?? null, bucket4?.wait ?? null);

  // Badge precedence: star > go > skip > walkOn. WalkOn only shown when no badge.
  const showBadge = badge !== null;
  const showWalkOn = walkOn && !showBadge;

  const isBelowNormal =
    isOperating && ride.currentWait !== null && bucket0?.wait != null &&
    bucket0.wait > 0 && (bucket0.sampleCount ?? 0) >= 1 &&
    ride.currentWait < bucket0.wait * 0.75;
  const isAboveNormal =
    isOperating && ride.currentWait !== null && bucket0?.wait != null &&
    bucket0.wait > 0 && (bucket0.sampleCount ?? 0) >= 1 &&
    ride.currentWait > bucket0.wait * 1.25;

  const waitColor = isBelowNormal ? colors.go : isAboveNormal ? colors.skip : colors.textPrimary;

  const showRow2 = walkMins != null || trend !== null;

  return (
    <Pressable
      onPress={() => openDetail({ rideId: ride.id, type: null, source: 'browse' })}
      testID={`ride-${ride.id}`}
    >
      <View style={styles.row}>
        {/* Row 1 */}
        <View style={styles.row1}>
          {/* Badge — left of name (star/go/skip only; walkOn handled on right) */}
          {showBadge && <Pill variant={badge!} />}

          {/* Name + optional bell */}
          <View style={styles.nameRow}>
            <Text style={styles.rideName}>{ride.name}</Text>
            {isWatching && <Bell size={12} color={colors.star} />}
          </View>

          {/* Right side: Walk On OR wait number */}
          <View style={styles.waitCluster}>
            {showWalkOn ? (
              <View style={styles.walkOnCluster}>
                <Footprints size={14} color={colors.textPrimary} />
                <Text style={styles.walkOnLabel}>Walk On</Text>
              </View>
            ) : isOperating && ride.currentWait !== null ? (
              <>
                <Text style={[styles.waitNumber, { color: waitColor }]}>
                  {ride.currentWait}
                </Text>
                <Text style={styles.waitMin}> min</Text>
              </>
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
              {walkMins != null ? (
                <View style={styles.walkPill}>
                  <Navigation2 size={10} color={colors.textTertiary} />
                  <Text style={styles.walkPillText}>~{walkMins} min</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.trendRow}>
              {trend ? <Text style={styles.trendLabel}>{TREND_LABEL[trend]}</Text> : null}
              {bucket0?.wait != null && bucket4?.wait != null ? (
                <TrendArrow
                  bucket0Wait={bucket0.wait}
                  bucket2Wait={bucket4.wait}
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
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
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
  waitCluster: {
    flexDirection: 'row',
    alignItems: 'baseline',
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
    color: colors.textSecondary,
  },
  walkOnCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  walkOnLabel: {
    ...typography.label,
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
  },
  walkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  walkPillText: {
    ...typography.caption,
    color: colors.textTertiary,
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
    color: colors.skip,
    marginTop: spacing.xs,
  },
});
