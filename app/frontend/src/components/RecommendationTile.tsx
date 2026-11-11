// Compact square tile for the "More to Consider" row on Recommendations:
// icon, ride name, walk pill, wait. Same wait logic and accent rule as
// RecommendationCard.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Recommendation, Ride } from '../types';
import { colors, spacing, typography } from '../theme/tokens';
import { Card } from './Card';
import { WalkPill } from './WalkPill';
import { RideIcon } from './icons/RideIcon';
import { recWaitLabel } from './RecommendationCard';

interface Props {
  rec: Recommendation;
  ride: Ride | undefined;
  onPress: () => void;
}

export function RecommendationTile({ rec, ride, onPress }: Props): React.ReactElement | null {
  if (!ride) return null;
  const waitLabel = recWaitLabel(rec, ride);
  const verdict = ride.verdict?.verdict ?? null;
  const accent = verdict === 'go' ? colors.go : verdict === 'star' ? colors.star : undefined;

  return (
    <Pressable onPress={onPress} style={styles.pressable} testID={`rec-tile-${rec.rideId}`}>
      <Card accent={accent} style={styles.card}>
        <RideIcon rideId={rec.rideId} size={36} />
        <Text style={styles.name} numberOfLines={2}>{ride.name}</Text>
        <View style={styles.meta}>
          {rec.walkMinutes !== null ? <WalkPill minutes={rec.walkMinutes} emphasized /> : null}
          {waitLabel ? <Text style={styles.wait}>{waitLabel}</Text> : null}
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
  wait: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
