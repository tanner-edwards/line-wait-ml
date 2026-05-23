// Detail view for a single recommendation: hero ride row + LLM paragraph +
// the existing DebugCard so the user can dig into the scoring numbers. The
// rec metadata (one-liner, paragraph, walk minutes) lives on the prior
// screen's recs payload, so this screen pulls it from navigation params
// alongside the rideId.

import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRides } from '../context/RideContext';
import { DebugCard } from '../components/DebugCard';
import { RecommendationBadge } from '../components/RecommendationBadge';
import { rideWaitLabel } from '../grouping';
import type { RecommendationsStackParamList } from '../navigation/AppNavigator';
import type { ScoreResult } from '../types';

const SUPPRESSED_SCORE: ScoreResult = {
  score: 0,
  badge: null,
  factors: {
    vsAvg: null,
    vsRange: null,
    projectedChange: null,
    nearTermChange: null,
  },
};

type Props = NativeStackScreenProps<RecommendationsStackParamList, 'RecommendationDetail'>;

export function RecommendationDetail({ route, navigation }: Props): React.ReactElement {
  const { rideId, oneLiner, paragraph, walkMinutes } = route.params;
  const { ridesById } = useRides();
  const ride = ridesById.get(rideId);

  if (!ride) {
    return (
      <SafeAreaView style={styles.container}>
        <Header onBack={() => navigation.goBack()} title="Recommendation" />
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Ride not found</Text>
          <Text style={styles.missingBody}>
            We don't have live data for this ride right now. Pull-to-refresh on Browse to retry.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const scoreResult = ride.score ?? SUPPRESSED_SCORE;
  const walkLabel = walkMinutes !== null ? `~${walkMinutes} min walk` : null;

  return (
    <SafeAreaView style={styles.container}>
      <Header onBack={() => navigation.goBack()} title={ride.land} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero ride row */}
        <View style={styles.hero}>
          <View style={styles.heroLeft}>
            <RecommendationBadge badge={scoreResult.badge} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rideName}>{ride.name}</Text>
              <Text style={styles.rideLand}>{ride.land}</Text>
            </View>
          </View>
          <View style={styles.heroRight}>
            <Text style={styles.rideWait}>{rideWaitLabel(ride)}</Text>
            {walkLabel ? <Text style={styles.walkText}>{walkLabel}</Text> : null}
          </View>
        </View>

        {/* LLM reasoning */}
        <View style={styles.reasoning}>
          <Text style={styles.oneLiner}>{oneLiner}</Text>
          <Text style={styles.paragraph}>{paragraph}</Text>
        </View>

        {/* Existing scoring breakdown */}
        <DebugCard ride={ride} result={scoreResult} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }): React.ReactElement {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} testID="detail-back">
        <Text style={styles.backLink}>← Back</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.backPlaceholder} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { paddingBottom: 24 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backLink: { color: '#6b6bf5', fontSize: 14, fontWeight: '600' },
  backPlaceholder: { width: 50 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
  },

  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  heroLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 4 },
  heroRight: { alignItems: 'flex-end' },
  rideName: { fontSize: 18, fontWeight: '700', color: '#222' },
  rideLand: { fontSize: 12, color: '#888', marginTop: 2 },
  rideWait: { fontSize: 16, fontWeight: '700', color: '#222' },
  walkText: { fontSize: 12, color: '#4a4ec7', marginTop: 4, fontWeight: '600' },

  reasoning: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  oneLiner: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 8 },
  paragraph: { fontSize: 13, color: '#444', lineHeight: 18 },

  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  missingTitle: { fontSize: 16, fontWeight: '700', color: '#c41e3a', marginBottom: 6 },
  missingBody: { fontSize: 13, color: '#666', textAlign: 'center' },
});
