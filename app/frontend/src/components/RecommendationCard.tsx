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
import { AlertTriangle, ChevronRight, Footprints } from 'lucide-react-native';
import { Recommendation, Ride, ScoreResult } from '../types';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { Card } from './Card';
import { Pill } from './Pill';
import { TrendArrow } from './TrendArrow';
import { WalkPill } from './WalkPill';
import { isWalkOnRide } from '../utils/walkOn';
import { trendDirection } from '../utils/trendDirection';
import { MIN_BUCKET_SAMPLE_COUNT } from '../scoreConstants';

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

interface RecommendationCardProps {
  rec: Recommendation;
  ride: Ride | undefined;
  debugMode: boolean;
  onPress: () => void;
}

export function RecommendationCard({ rec, ride, debugMode, onPress }: RecommendationCardProps): React.ReactElement {
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
  const bucket1 = ha?.buckets[1] ?? null;
  const bucket3 = ha?.buckets[3] ?? null;
  const bucket4 = ha?.buckets[4] ?? null;
  const lowConfidence = (bucket0?.sampleCount ?? 0) < MIN_BUCKET_SAMPLE_COUNT;
  const scoreResult = ride.score ?? SUPPRESSED_SCORE;
  const badge = scoreResult.badge;
  const walkOnRaw = isOperating && isWalkOnRide(ride.id, ride.currentWait)
    && (rec.arrivalWait === null || rec.arrivalWait <= 15);
  // Badge precedence: star > walkOn > go > skip. Walk On beats go/skip, not star.
  const showWalkOn = walkOnRaw && badge !== 'star';
  const showBadge = badge !== null && !showWalkOn;
  // Trend combines real past observations with the historical-average future
  // curve. We anchor "current" on arrivalWait when available (the wait the
  // guest will actually face after walking over) — the past observation
  // becomes the "where the ride was when we last polled".
  const trendInput = {
    currentWait: rec.arrivalWait ?? ride.currentWait,
    recentWait: ride.recentHistory?.[0]?.wait ?? null,
    bucket1Wait: bucket1?.wait ?? null,
    bucket3Wait: bucket3?.wait ?? null,
    bucket4Wait: bucket4?.wait ?? null,
  };
  const trend = trendDirection(trendInput);

  const isBelowNormal =
    isOperating &&
    (rec.arrivalWait ?? ride.currentWait) !== null &&
    bucket0?.wait != null &&
    bucket0.wait > 0 &&
    (bucket0.sampleCount ?? 0) >= MIN_BUCKET_SAMPLE_COUNT &&
    ((rec.arrivalWait ?? ride.currentWait) as number) < bucket0.wait * 0.75;

  const waitColor = isBelowNormal ? colors.go : colors.textPrimary;

  const waitDisplay = rec.arrivalWait !== null
    ? `${rec.arrivalWait}`
    : ride.currentWait !== null
    ? `${ride.currentWait}`
    : null;

  const cardVariant = 'default' as const;
  const cardAccent = badge === 'go' ? colors.go : badge === 'star' ? colors.star : undefined;

  return (
    <Pressable
      onPress={onPress}
      testID={`rec-card-${rec.rideId}`}
      style={styles.pressable}
    >
      <Card variant={cardVariant} accent={cardAccent}>
        {/* Row 1 */}
        <View style={styles.row1}>
          <View style={styles.nameRow}>
            <Text style={styles.rideName}>{ride.name}</Text>
            {rec.restrictionNote ? (
              <AlertTriangle size={13} color={colors.star} />
            ) : null}
          </View>
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
        {(showBadge || trend) ? (
          <View style={styles.row2}>
            <View style={styles.badgeRow}>
              {showBadge ? <Pill variant={badge!} /> : null}
            </View>
            <View style={styles.trendRow}>
              {trend ? (
                <Text style={styles.trendLabel}>{TREND_LABEL[trend]}</Text>
              ) : null}
              {bucket0?.wait != null && bucket4?.wait != null ? (
                <TrendArrow
                  {...trendInput}
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
        {rec.walkMinutes !== null ? (
          <View style={styles.walkPillRow}>
            <WalkPill
              minutes={rec.walkMinutes}
              yards={debugMode ? rec.walkYards : null}
              emphasized
              testID={`rec-walk-${rec.rideId}`}
            />
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
  nameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginRight: spacing.md,
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
  walkPillRow: {
    marginTop: spacing.sm,
  },
});
