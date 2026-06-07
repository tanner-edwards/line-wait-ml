// Elevated Card item for the Recommendations tab.
//
// Same two-row skeleton as RideRow but with more padding and an AI copy
// paragraph (Row 3) + walk-time pill (Row 4).
//
// Row 1: [Ride name] ←→ [Arrival wait + "min" + ChevronRight]
// Row 2: [Optional Badge] ←→ [Trend label + TrendArrow]
// Row 3: AI copy paragraph
// Row 4: Walk-time pill

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Footprints, Navigation2 } from 'lucide-react-native';
import { Recommendation, Ride, ScoreResult } from '../types';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { Card } from './Card';
import { Pill } from './Pill';
import { TrendArrow } from './TrendArrow';
import { isWalkOnRide } from '../utils/walkOn';
import { useNotificationDetail } from '../context/NotificationDetailContext';

const SUPPRESSED_SCORE: ScoreResult = {
  score: 0,
  badge: null,
  factors: {
    vsAvg: null,
    vsRange: null,
    projectedChange: null,
    nearTermChange: null,
    rapidChange: null,
  },
};

const TREND_LABEL = { down: 'Dropping', up: 'Rising', stable: 'Steady' } as const;

function trendDir(
  b0: number | null,
  b4: number | null
): 'down' | 'up' | 'stable' | null {
  if (!b0 || !b4 || b0 === 0) return null;
  if (b4 < b0 * 0.9) return 'down';
  if (b4 > b0 * 1.1) return 'up';
  return 'stable';
}

interface RecommendationCardProps {
  rec: Recommendation;
  ride: Ride | undefined;
}

export function RecommendationCard({ rec, ride }: RecommendationCardProps): React.ReactElement {
  const { openDetail } = useNotificationDetail();

  if (!ride) {
    return (
      <View style={styles.skeleton} testID={`rec-card-${rec.rideId}`}>
        <Text style={styles.skeletonText}>Loading…</Text>
      </View>
    );
  }

  const isOperating = ride.status === 'OPERATING';
  const ha = ride.historicalAverage;
  const bucket0 = ha?.buckets[0] ?? null;
  const bucket4 = ha?.buckets[4] ?? null;
  const lowConfidence = (bucket0?.sampleCount ?? 0) < 1;
  const scoreResult = ride.score ?? SUPPRESSED_SCORE;
  const badge = scoreResult.badge;
  const walkOnRaw = isOperating && isWalkOnRide(ride.id, ride.currentWait)
    && (rec.arrivalWait === null || rec.arrivalWait <= 15);
  // Badge precedence: star > go > skip > walkOn. WalkOn only shown when no badge.
  const showWalkOn = walkOnRaw && badge === null;
  const trend = trendDir(bucket0?.wait ?? null, bucket4?.wait ?? null);

  const isBelowNormal =
    isOperating &&
    (rec.arrivalWait ?? ride.currentWait) !== null &&
    bucket0?.wait != null &&
    bucket0.wait > 0 &&
    (bucket0.sampleCount ?? 0) >= 1 &&
    ((rec.arrivalWait ?? ride.currentWait) as number) < bucket0.wait * 0.75;

  const waitColor = isBelowNormal ? colors.go : colors.textPrimary;

  const waitDisplay = rec.arrivalWait !== null
    ? `${rec.arrivalWait}`
    : ride.currentWait !== null
    ? `${ride.currentWait}`
    : null;

  const walkLabel = rec.walkMinutes !== null
    ? `~${rec.walkMinutes} min${rec.walkYards !== null ? ` · ${rec.walkYards} yds` : ''}`
    : null;

  const cardVariant = 'default' as const;
  const cardAccent = badge === 'go' ? colors.go : badge === 'star' ? colors.star : undefined;

  return (
    <Pressable
      onPress={() => openDetail({ rideId: rec.rideId, type: null, source: 'browse' })}
      testID={`rec-card-${rec.rideId}`}
      style={styles.pressable}
    >
      <Card variant={cardVariant} accent={cardAccent}>
        {/* Row 1 */}
        <View style={styles.row1}>
          <Text style={styles.rideName}>{ride.name}</Text>
          <View style={styles.waitCluster}>
            {showWalkOn ? (
              <View style={styles.walkOnCluster}>
                <Footprints size={14} color={colors.textPrimary} />
                <Text style={styles.walkOnLabel}>Walk On</Text>
              </View>
            ) : waitDisplay !== null ? (
              <>
                <Text style={[styles.waitNumber, { color: waitColor }]}>
                  {waitDisplay}
                </Text>
                <Text style={styles.waitMin}> min</Text>
              </>
            ) : (
              <Text style={styles.waitStatus}>—</Text>
            )}
            <ChevronRight size={14} color={colors.textTertiary} />
          </View>
        </View>

        {/* Row 2 */}
        {(badge || trend) ? (
          <View style={styles.row2}>
            <View style={styles.badgeRow}>
              {badge ? <Pill variant={badge} /> : null}
            </View>
            <View style={styles.trendRow}>
              {trend ? (
                <Text style={styles.trendLabel}>{TREND_LABEL[trend]}</Text>
              ) : null}
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

        {/* Row 3 — AI copy */}
        {rec.oneLiner ? (
          <Text style={styles.oneLiner}>{rec.oneLiner}</Text>
        ) : null}

        {/* Row 4 — walk-time pill */}
        {walkLabel ? (
          <View style={styles.walkPill} testID={`rec-walk-${rec.rideId}`}>
            <Navigation2 size={11} color={colors.brand} />
            <Text style={styles.walkPillText}>{walkLabel}</Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
  },
  skeleton: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
  },
  skeletonText: {
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  row1: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rideName: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.md,
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
    marginTop: spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  oneLiner: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  walkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: spacing.sm,
  },
  walkPillText: {
    ...typography.caption,
    color: colors.brand,
    fontWeight: '600',
  },
});
