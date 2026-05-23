// One card per recommendation. Reuses the same visual vocabulary as the
// Browse list row — badge, name, current wait, trend arrow, normal-band
// pill — plus the v2-specific LLM one-liner + walk-time pill.
//
// Tap → detail screen (the navigator wires this; the card just calls onPress).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Recommendation, Ride } from '../types';
import { RecommendationBadge } from './RecommendationBadge';
import { TrendArrow } from './TrendArrow';
import { BelowNormalBadge } from './BelowNormalBadge';
import { isWalkOnRide } from '../utils/walkOn';
import { rideWaitLabel } from '../grouping';

interface RecommendationCardProps {
  rec: Recommendation;
  ride: Ride | undefined;          // resolved from RideContext; undefined = ride list still loading
  onPress: () => void;
}

export function RecommendationCard({ rec, ride, onPress }: RecommendationCardProps): React.ReactElement {
  // Skeleton when ride context hasn't resolved the rideId yet — keeps the
  // card height stable instead of popping rows in.
  if (!ride) {
    return (
      <View style={styles.card} testID={`rec-card-${rec.rideId}`}>
        <Text style={styles.skeletonText}>Loading…</Text>
      </View>
    );
  }

  const ha = ride.historicalAverage;
  const isOperating = ride.status === 'OPERATING';
  const showIndicators = isOperating && ha !== null;
  const bucket0 = showIndicators && ha ? ha.buckets[0] : null;
  const bucket4 = showIndicators && ha ? ha.buckets[4] : null;
  const lowConfidence = (bucket0?.sampleCount ?? 0) < 1;
  const badge = ride.score?.badge ?? null;
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait);
  const walkLabel = rec.walkMinutes !== null ? `~${rec.walkMinutes} min walk` : null;

  return (
    <Pressable onPress={onPress} style={styles.card} testID={`rec-card-${rec.rideId}`}>
      <View style={styles.headerRow}>
        {badge === 'star'
          ? <RecommendationBadge badge="star" />
          : walkOn
          ? <Text style={styles.walkOnEmoji} testID="rec-badge-walk-on">🚶</Text>
          : <RecommendationBadge badge={badge} />}
        <Text style={styles.rideName} numberOfLines={1}>{ride.name}</Text>
        <View style={styles.rightCluster}>
          <View style={styles.waitRow}>
            <Text style={styles.rideWait}>{rideWaitLabel(ride)}</Text>
            {showIndicators && bucket4 ? (
              <TrendArrow
                bucket0Wait={ride.currentWait}
                bucket2Wait={bucket4.wait}
                lowConfidence={lowConfidence}
              />
            ) : null}
          </View>
          {showIndicators && bucket0 ? (
            <BelowNormalBadge
              currentWait={ride.currentWait}
              bucket0Wait={bucket0.wait}
              sampleCount={bucket0.sampleCount}
            />
          ) : null}
        </View>
      </View>

      <Text style={styles.oneLiner} numberOfLines={2}>{rec.oneLiner}</Text>

      {walkLabel ? (
        <View style={styles.walkPill} testID={`rec-walk-${rec.rideId}`}>
          <Text style={styles.walkPillText}>{walkLabel}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rideName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#222',
    marginLeft: 4,
  },
  rightCluster: {
    alignItems: 'flex-end',
  },
  waitRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rideWait: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222',
  },
  walkOnEmoji: {
    fontSize: 18,
    marginRight: 4,
  },
  oneLiner: {
    fontSize: 13,
    color: '#555',
    marginTop: 6,
    marginLeft: 32,
  },
  walkPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#eef0fb',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 6,
    marginLeft: 32,
  },
  walkPillText: {
    fontSize: 12,
    color: '#4a4ec7',
    fontWeight: '600',
  },
  skeletonText: {
    color: '#aaa',
    fontStyle: 'italic',
  },
});
