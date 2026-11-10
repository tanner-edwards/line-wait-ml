// Compact square tile for the "More to Consider" row on Recommendations —
// ride name over its wait. Same wait logic as RecommendationCard.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Footprints } from 'lucide-react-native';
import { Recommendation, Ride } from '../types';
import { colors, spacing, typography } from '../theme/tokens';
import { Card } from './Card';
import { recWaitDisplay } from './RecommendationCard';

interface Props {
  rec: Recommendation;
  ride: Ride | undefined;
  onPress: () => void;
}

export function RecommendationTile({ rec, ride, onPress }: Props): React.ReactElement | null {
  if (!ride) return null;
  const { walkOn, wait } = recWaitDisplay(rec, ride);

  return (
    <Pressable onPress={onPress} style={styles.pressable} testID={`rec-tile-${rec.rideId}`}>
      <Card style={styles.card}>
        <Text style={styles.name} numberOfLines={2}>{ride.name}</Text>
        <View style={styles.waitRow}>
          {walkOn ? (
            <>
              <Footprints size={14} color={colors.go} />
              <Text style={styles.walkOn}>Walk On</Text>
            </>
          ) : wait !== null ? (
            <>
              <Text style={styles.waitNumber}>{wait}</Text>
              <Text style={styles.waitMin}> min</Text>
            </>
          ) : (
            <Text style={styles.waitMin}>—</Text>
          )}
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
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    minHeight: 96,
  },
  name: {
    ...typography.label,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  waitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.sm,
  },
  waitNumber: {
    ...typography.waitNumber,
    fontSize: 20,
    color: colors.textPrimary,
  },
  waitMin: {
    ...typography.label,
    color: colors.textSecondary,
    alignSelf: 'flex-end',
    paddingBottom: 2,
  },
  walkOn: {
    ...typography.label,
    fontWeight: '600',
    color: colors.go,
  },
});
