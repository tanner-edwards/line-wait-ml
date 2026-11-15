// Elevated Card item for the Recommendations tab (top picks + the See All
// list). Same layout as the Discover RideRow, plus the AI one-liner spanning
// the full card width underneath:
//
// [Ride icon]  Ride name [⚠]                                 [›]
//              [★ GO NOW]  N min wait               [🚶 N min]
// AI one-liner, full width — what the ride is doing and why it's
// recommended.
//
// Badge (if any) left-aligned with the name, walk pill right-aligned.
// Neutral = no badge. Star ("rare opportunity") cards get a gold border +
// glow. Tiles keep the old icon-only badge.

import React, { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { AlertTriangle, ChevronRight } from 'lucide-react-native';
import { Recommendation, Ride } from '../types';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { Card } from './Card';
import { VerdictBadge } from './VerdictBadge';
import { SwipeToRetireRow } from './SwipeToRetireRow';
import { RideIcon } from './icons/RideIcon';
import { WalkPill } from './WalkPill';
import { isWalkOnRide } from '../utils/walkOn';
import { roundWait } from '../utils/roundWait';
import { NO_POSTED_WAIT } from '../grouping';

const ICON_SIZE = 52;  // matches the Discover RideRow

/** Gold border + gold glow for star ("rare opportunity") recs — shared with
 *  RecommendationTile. */
export const RARE_CARD_STYLE: ViewStyle = {
  borderWidth: 1,
  borderColor: colors.star,
  shadowColor: colors.star,
  shadowOffset: { width: 0, height: 0 },
  shadowRadius: 10,
  shadowOpacity: 0.35,
  elevation: 6,
};

interface RecommendationCardProps {
  rec: Recommendation;
  ride: Ride | undefined;
  onPress: () => void;
  /** Marks this ride "Rode it" — excluded from recs for the rest of the trip. */
  onRetire: () => void;
  /** Only the first card in the list plays the one-time swipe-hint animation. */
  isFirst?: boolean;
}

/** "Walk On" / "N min wait" / "No posted wait" / null — shared with
 *  RecommendationTile. */
export function recWaitLabel(rec: Recommendation, ride: Ride): string | null {
  const { walkOn, wait } = recWaitDisplay(rec, ride);
  if (walkOn) return 'Walk On';
  if (wait !== null) return `${wait} min wait`;
  return ride.status === 'OPERATING' ? NO_POSTED_WAIT : null;
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

  // Badge = the authoritative two-layer verdict (neutral → no badge).
  const rawVerdict = ride.verdict?.verdict ?? null;
  const badge = rawVerdict && rawVerdict !== 'neutral' ? rawVerdict : null;
  const isStar = badge === 'star';
  const { walkOn } = recWaitDisplay(rec, ride);
  const waitLabel = recWaitLabel(rec, ride);

  return (
    <View style={styles.rowMargin}>
      <SwipeToRetireRow onConfirm={onRetire} isFirst={isFirst} testID={`rec-swipe-${rec.rideId}`}>
        <Pressable onPress={onPress} testID={`rec-card-${rec.rideId}`}>
          <Card style={isStar ? { ...styles.cardPadding, ...RARE_CARD_STYLE } : styles.cardPadding} testID={isStar ? `rec-rare-${rec.rideId}` : undefined}>
            <View style={styles.layout}>
              <RideIcon rideId={rec.rideId} rideName={ride.name} size={ICON_SIZE} />
              <View style={styles.content}>
                <View style={styles.nameRow}>
                  <Text style={styles.rideName}>{ride.name}</Text>
                  {rec.restrictionNote ? (
                    <AlertTriangle size={13} color={colors.star} />
                  ) : null}
                </View>
                {badge || waitLabel || rec.walkMinutes !== null ? (
                  <MetaRow
                    rideId={rec.rideId}
                    badge={badge}
                    waitLabel={waitLabel}
                    walkOn={walkOn}
                    walkMinutes={rec.walkMinutes}
                  />
                ) : null}
              </View>
              <ChevronRight size={18} color={colors.textTertiary} />
            </View>
            {rec.oneLiner ? (
              <Text style={styles.oneLiner}>{rec.oneLiner}</Text>
            ) : null}
          </Card>
        </Pressable>
      </SwipeToRetireRow>
    </View>
  );
}

const META_GAP = 10;

/** "30 min wait" → "30 min" when the full label won't fit beside the badge and
 *  walk pill. Other labels (Walk On, No posted wait) have no short form. */
function shortWaitLabel(label: string): string {
  return label.endsWith(' min wait') ? label.slice(0, -' wait'.length) : label;
}

interface MetaRowProps {
  rideId: string;
  badge: React.ComponentProps<typeof VerdictBadge>['variant'] | null;
  waitLabel: string | null;
  walkOn: boolean;
  walkMinutes: number | null;
}

/**
 * Badge · wait · walk pill on one line. Measures the row, the badge, the pill
 * and the full wait label (an invisible copy, so its natural width isn't
 * squeezed by the flex row); if the full label won't fit it drops "wait".
 */
export function MetaRow({ rideId, badge, waitLabel, walkOn, walkMinutes }: MetaRowProps): React.ReactElement {
  const [rowW, setRowW] = useState(0);
  const [badgeW, setBadgeW] = useState(0);
  const [pillW, setPillW] = useState(0);
  const [labelW, setLabelW] = useState(0);
  const w = (set: (n: number) => void) => (e: LayoutChangeEvent) => set(e.nativeEvent.layout.width);

  const items = [badge, waitLabel, walkMinutes !== null].filter(Boolean).length;
  const needed = badgeW + labelW + pillW + META_GAP * Math.max(items - 1, 0);
  const tight = rowW > 0 && labelW > 0 && needed > rowW;
  const shown = waitLabel && tight ? shortWaitLabel(waitLabel) : waitLabel;
  const labelStyle = [styles.waitLabel, walkOn && styles.walkOnLabel, waitLabel === NO_POSTED_WAIT && styles.noWaitLabel];

  return (
    <View style={styles.metaRow} onLayout={w(setRowW)} testID={`rec-meta-${rideId}`}>
      {badge ? (
        <View style={styles.noShrink} onLayout={w(setBadgeW)} testID={`rec-meta-badge-${rideId}`}>
          <VerdictBadge variant={badge} />
        </View>
      ) : null}
      {waitLabel ? (
        <>
          <Text numberOfLines={1} style={labelStyle} testID={`rec-meta-wait-${rideId}`}>{shown}</Text>
          <Text style={[labelStyle, styles.measure]} onLayout={w(setLabelW)} aria-hidden testID={`rec-meta-measure-${rideId}`}>{waitLabel}</Text>
        </>
      ) : null}
      {walkMinutes !== null ? (
        <View style={styles.walkEnd} onLayout={w(setPillW)} testID={`rec-meta-pill-${rideId}`}>
          <WalkPill minutes={walkMinutes} testID={`rec-walk-${rideId}`} />
        </View>
      ) : null}
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
  // Pushes the walk pill to the right edge of the text column, which ends
  // where the chevron's gap begins. Never shrinks — the wait label gives way.
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
  // Narrower side padding than the base Card (14) — gives the meta row room
  // so the badge, wait and walk pill fit on one line.
  cardPadding: { paddingHorizontal: 10 },
  // Single line: the card's padding leaves less width than a Discover row,
  // so wrapping pushed the walk pill onto its own line. Tighter gap than
  // RideRow for the same reason; MetaRow drops "wait" if it still won't fit.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: META_GAP,
    marginTop: spacing.xs,
  },
  waitLabel: {
    ...typography.label,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  noShrink: { flexShrink: 0 },
  // Off-screen copy of the full wait label, measured at its natural width.
  measure: { position: 'absolute', opacity: 0, left: 0, top: 0 },
  walkOnLabel: { color: colors.go },
  noWaitLabel: { color: colors.textSecondary, fontWeight: '500' },
  // Spans the whole card, under the icon/name/chevron row.
  oneLiner: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
});
