// Elevated Card item for the Recommendations tab (top picks + More to
// Consider rows).
//
// [Ride icon]  [★ Rare opportunity]           (star only)
//              [Badge] Ride name [⚠]          [›]
//              AI one-liner
//              [~N min walk pill] · N min wait
//
// The trend label was dropped in the phase-2 redesign: the arrival wait
// already folds it in, and ride detail keeps the evidence.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, ChevronRight, Star } from 'lucide-react-native';
import { Recommendation, Ride } from '../types';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { Card } from './Card';
import { Pill } from './Pill';
import { WalkPill } from './WalkPill';
import { SwipeToRetireRow } from './SwipeToRetireRow';
import { RideIcon } from './icons/RideIcon';
import { isWalkOnRide } from '../utils/walkOn';
import { roundWait } from '../utils/roundWait';

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

/** "Walk On" / "N min wait" / null — shared with RecommendationTile. */
export function recWaitLabel(rec: Recommendation, ride: Ride): string | null {
  const { walkOn, wait } = recWaitDisplay(rec, ride);
  if (walkOn) return 'Walk On';
  return wait !== null ? `${wait} min wait` : null;
}

/**
 * The wait a rec shows: "Walk On", the arrival wait, or the current wait.
 * Shared with RecommendationTile so a ride reads the same in both places.
 */
export function recWaitDisplay(rec: Recommendation, ride: Ride): { walkOn: boolean; wait: string | null } {
  const isOperating = ride.status === 'OPERATING';
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait)
    && (rec.arrivalWait === null || rec.arrivalWait <= 15);
  const wait = rec.arrivalWait !== null
    ? `${roundWait(rec.arrivalWait)}`
    : ride.currentWait !== null
    ? `${ride.currentWait}`
    : null;
  return { walkOn, wait };
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

  // Badge = the authoritative two-layer verdict (neutral → no chip). Star gets
  // its own "Rare opportunity" line instead of an inline icon.
  const rawVerdict = ride.verdict?.verdict ?? null;
  const badge = rawVerdict && rawVerdict !== 'neutral' ? rawVerdict : null;
  const isStar = badge === 'star';
  const waitLabel = recWaitLabel(rec, ride);
  const cardAccent = badge === 'go' ? colors.go : isStar ? colors.star : undefined;

  return (
    <View style={styles.rowMargin}>
      <SwipeToRetireRow onConfirm={onRetire} isFirst={isFirst} testID={`rec-swipe-${rec.rideId}`}>
        <Pressable onPress={onPress} testID={`rec-card-${rec.rideId}`}>
          <Card accent={cardAccent}>
            <View style={styles.layout}>
              <RideIcon rideId={rec.rideId} size={48} />
              <View style={styles.content}>
                {isStar ? (
                  <View style={styles.starRow}>
                    <Star size={13} color={colors.star} fill={colors.star} />
                    <Text style={styles.starLabel}>Rare opportunity</Text>
                  </View>
                ) : null}
                <View style={styles.nameRow}>
                  {badge && !isStar ? <Pill variant={badge} /> : null}
                  <Text style={styles.rideName}>{ride.name}</Text>
                  {rec.restrictionNote ? (
                    <AlertTriangle size={13} color={colors.star} />
                  ) : null}
                </View>
                {rec.oneLiner ? (
                  <Text style={styles.oneLiner}>{rec.oneLiner}</Text>
                ) : null}
                {rec.walkMinutes !== null || waitLabel ? (
                  <View style={styles.metaRow}>
                    {rec.walkMinutes !== null ? (
                      <WalkPill
                        minutes={rec.walkMinutes}
                        yards={debugMode ? rec.walkYards : null}
                        emphasized
                        testID={`rec-walk-${rec.rideId}`}
                      />
                    ) : null}
                    {rec.walkMinutes !== null && waitLabel ? (
                      <Text style={styles.metaDot}>·</Text>
                    ) : null}
                    {waitLabel ? <Text style={styles.waitLabel}>{waitLabel}</Text> : null}
                  </View>
                ) : null}
              </View>
              <ChevronRight size={18} color={colors.textTertiary} />
            </View>
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
  layout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  content: { flex: 1 },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  starLabel: {
    ...typography.label,
    fontWeight: '600',
    color: colors.star,
  },
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
  oneLiner: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  metaDot: {
    ...typography.label,
    color: colors.textTertiary,
  },
  waitLabel: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
