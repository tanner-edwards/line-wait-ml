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
import { TrendArrow, trajectoryDirection } from './TrendArrow';
import { WalkPill } from './WalkPill';
import { isWalkOnRide } from '../utils/walkOn';
import { roundWait } from '../utils/roundWait';

const SUPPRESSED_SCORE: ScoreResult = {
  score: 0,
  badge: null,
  factors: {
    zone: 'suppressed', typical: null, worthWeight: null, valueMinutes: null,
    betterWindowWait: null, betterWindowInMin: null, recoverableNet: null,
    reachableSoon: false, climb: false, trajectory: null, rapidChange: null,
  },
};

const TREND_LABEL = { down: 'Dropping', up: 'Rising' } as const;

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
  // scoreResult retained only for the trend arrow's trajectory (not in verdict).
  const scoreResult = ride.score ?? SUPPRESSED_SCORE;
  // Badge = the authoritative two-layer verdict (neutral → no chip).
  const rawVerdict = ride.verdict?.verdict ?? null;
  const badge = rawVerdict && rawVerdict !== 'neutral' ? rawVerdict : null;
  const walkOnRaw = isOperating && isWalkOnRide(ride.id, ride.currentWait)
    && (rec.arrivalWait === null || rec.arrivalWait <= 15);
  // Badge precedence: star > walkOn > go > skip. Walk On beats go/skip, not star.
  const showWalkOn = walkOnRaw && badge !== 'star';
  const showBadge = badge !== null && !showWalkOn;
  // Trend — single source of truth is the server verdict's trajectory. No local
  // recompute; Steady / absent renders nothing.
  const trend = isOperating ? trajectoryDirection(scoreResult.factors.trajectory) : null;

  const waitDisplay = rec.arrivalWait !== null
    ? `${roundWait(rec.arrivalWait)}`
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
                <Footprints size={14} color={colors.go} />
                <Text style={[styles.walkOnLabel, { color: colors.go }]}>Walk On</Text>
              </View>
            ) : waitDisplay !== null ? (
              <>
                <Text style={styles.waitNumber}>{waitDisplay}</Text>
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
                <>
                  <Text style={styles.trendLabel}>{TREND_LABEL[trend]}</Text>
                  <TrendArrow direction={trend} />
                </>
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
