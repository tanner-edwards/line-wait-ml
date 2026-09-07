// Elevated Card item for the Recommendations tab.
//
// Same two-row skeleton as RideRow but with more padding and an AI copy
// paragraph (Row 3) + walk-time pill (Row 4).
//
// Row 1: [Optional Badge] [Ride name] ←→ [Arrival wait + "min" + ChevronRight]
// Row 2: [Trend label + TrendArrow]
// Row 3: AI copy paragraph
// Row 4: Walk-time pill

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, ChevronRight, Footprints } from 'lucide-react-native';
import { Recommendation, Ride } from '../types';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { Card } from './Card';
import { Pill } from './Pill';
import { TrendArrow, trajectoryDirection, predictionTrajectory } from './TrendArrow';
import { WalkPill } from './WalkPill';
import { SwipeToRetireRow } from './SwipeToRetireRow';
import { isWalkOnRide } from '../utils/walkOn';
import { roundWait } from '../utils/roundWait';

const TREND_LABEL = { down: 'Dropping', up: 'Rising' } as const;

interface RecommendationCardProps {
  rec: Recommendation;
  ride: Ride | undefined;
  debugMode: boolean;
  onPress: () => void;
  /** Marks this ride "Rode it" — excluded from recs for the rest of the trip. */
  onRetire: () => void;
  /** Only the first card in the list plays the one-time swipe-hint animation. */
  isFirst?: boolean;
}

export function RecommendationCard({
  rec,
  ride,
  debugMode,
  onPress,
  onRetire,
  isFirst,
}: RecommendationCardProps): React.ReactElement {
  if (!ride) {
    return (
      <View style={styles.skeleton} testID={`rec-card-${rec.rideId}`}>
        <Text style={styles.skeletonText}>Loading…</Text>
      </View>
    );
  }

  const isOperating = ride.status === 'OPERATING';
  // Badge = the authoritative two-layer verdict (neutral → no chip).
  const rawVerdict = ride.verdict?.verdict ?? null;
  const badge = rawVerdict && rawVerdict !== 'neutral' ? rawVerdict : null;
  const walkOnRaw = isOperating && isWalkOnRide(ride.id, ride.currentWait)
    && (rec.arrivalWait === null || rec.arrivalWait <= 15);
  // "Walk On" is just the wait-value relabel; the badge is the verdict. They're
  // independent — a walk-on ride shows both its badge (if any) and "Walk On".
  const showWalkOn = walkOnRaw;
  const showBadge = badge !== null;
  // Trend — single source of truth is the server verdict's trajectory. No local
  // recompute; Steady / absent renders nothing.
  const trend = isOperating ? trajectoryDirection(predictionTrajectory(ride.prediction)) : null;

  const waitDisplay = rec.arrivalWait !== null
    ? `${roundWait(rec.arrivalWait)}`
    : ride.currentWait !== null
    ? `${ride.currentWait}`
    : null;

  const cardVariant = 'default' as const;
  const cardAccent = badge === 'go' ? colors.go : badge === 'star' ? colors.star : undefined;

  return (
    <View style={styles.rowMargin}>
      <SwipeToRetireRow onConfirm={onRetire} isFirst={isFirst} testID={`rec-swipe-${rec.rideId}`}>
        <Pressable onPress={onPress} testID={`rec-card-${rec.rideId}`}>
          <Card variant={cardVariant} accent={cardAccent}>
            {/* Row 1 */}
            <View style={styles.row1}>
              {showBadge ? <Pill variant={badge!} /> : null}
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

            {/* Row 2 — trend only; badge now lives in Row 1 next to the title */}
            {trend ? (
              <View style={styles.row2}>
                <Text style={styles.trendLabel}>{TREND_LABEL[trend]}</Text>
                <TrendArrow direction={trend} />
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
      </SwipeToRetireRow>
    </View>
  );
}

const styles = StyleSheet.create({
  rowMargin: {
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
    // flex-start (not center) — a 2-line ride name grows this row taller, and
    // centering would re-center the wait cluster within that extra height,
    // making it drift down relative to single-line-title cards. Anchoring to
    // the top keeps the wait number level with the first line every time.
    alignItems: 'flex-start',
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
    // center, not baseline — waitMin already overrides its own cross-axis
    // alignment (alignSelf: 'flex-end' below), and ChevronRight has no real
    // text baseline to align to, so 'baseline' here fights that override
    // rather than complementing it. RideRow's equivalent cluster uses
    // 'center' with the same waitMin override and doesn't have this problem.
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
    // Right-aligned — the trend relates to the wait number above it, not
    // the title, so it should sit under that side, not under the title.
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
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
