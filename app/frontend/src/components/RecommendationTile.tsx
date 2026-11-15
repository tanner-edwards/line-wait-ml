// Compact square tile for the "More to Consider" row on Recommendations:
// icon, ride name, walk pill, wait. Same wait logic as RecommendationCard,
// but keeps the old icon-only verdict badge (top-left corner) — tiles are too
// small for the solid call-to-action badge. Neutral = no badge. Star tiles
// also get the rare-opportunity gold border + glow, same as the cards.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Recommendation, Ride } from '../types';
import { colors, spacing, typography } from '../theme/tokens';
import { Card } from './Card';
import { Pill } from './Pill';
import { WalkPill } from './WalkPill';
import { WaitPill } from './WaitPill';
import { RideIcon } from './icons/RideIcon';
import { RARE_CARD_STYLE, recWaitLabel } from './RecommendationCard';

interface Props {
  rec: Recommendation;
  ride: Ride | undefined;
  onPress: () => void;
}

export function RecommendationTile({ rec, ride, onPress }: Props): React.ReactElement | null {
  if (!ride) return null;
  const waitLabel = recWaitLabel(rec, ride);
  const verdict = ride.verdict?.verdict ?? null;
  const badge = verdict && verdict !== 'neutral' ? verdict : null;

  return (
    <Pressable onPress={onPress} style={styles.pressable} testID={`rec-tile-${rec.rideId}`}>
      <Card style={verdict === 'star' ? { ...styles.card, ...RARE_CARD_STYLE } : styles.card}>
        {badge ? (
          <View style={styles.badgeCorner}>
            <Pill variant={badge} />
          </View>
        ) : null}
        <RideIcon rideId={rec.rideId} rideName={ride.name} size={44} />
        <Text style={styles.name} numberOfLines={2}>{ride.name}</Text>
        <View style={styles.meta}>
          {rec.walkMinutes !== null ? <WalkPill minutes={rec.walkMinutes} emphasized /> : null}
          {waitLabel ? (
            <WaitPill style={styles.waitPill}>
              <Text style={styles.wait} numberOfLines={1}>{waitLabel}</Text>
            </WaitPill>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { flex: 1 },
  card: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  badgeCorner: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
  },
  name: {
    ...typography.label,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  meta: {
    marginTop: 'auto',
    alignItems: 'center',
    gap: spacing.xs,
  },
  waitPill: { alignSelf: 'center' },
  wait: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
