// More to Consider — pushed from Recommendations' "See All".
//
// Lists only recs past the first batch (the main screen already shows the
// first batch as cards + tiles). Opening the screen fetches the next batch if
// nothing past the first batch is loaded yet; Show more appends further
// batches. The list is shared with the main screen via RecsContext.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CircleAlert, ListChecks } from 'lucide-react-native';
import { GradientHeader } from '../components/GradientHeader';
import { RecommendationCard } from '../components/RecommendationCard';
import { StateBlock } from '../components/StateBlock';
import { UndoToast } from '../components/UndoToast';
import { useRecs } from '../context/RecsContext';
import { useRides } from '../context/RideContext';
import { useDevice } from '../context/DeviceContext';
import { useDebugMode } from '../context/DebugModeContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { colors, spacing, typography } from '../theme/tokens';

export function MoreToConsider(): React.ReactElement {
  const navigation = useNavigation();
  const { recs, firstBatchCount, loadMore, loadingMore, loadMoreError } = useRecs();
  const { ridesById } = useRides();
  const { retiredRideIds, retireRide, unretireRide } = useDevice();
  const { debugMode } = useDebugMode();
  const { openDetail } = useNotificationDetail();
  const [undoToast, setUndoToast] = useState<{ rideId: string; key: number } | null>(null);

  const extraRecs = (recs?.recommendations ?? [])
    .slice(firstBatchCount)
    .filter(r => !retiredRideIds.includes(r.rideId));
  const hasLoadedExtras = (recs?.recommendations.length ?? 0) > firstBatchCount;

  // First open: fetch the next batch. Once per mount — a failed fetch shows
  // Try again rather than retrying on its own.
  const autoFetched = useRef(false);
  useEffect(() => {
    if (autoFetched.current || !recs || hasLoadedExtras || !recs.hasMore) return;
    autoFetched.current = true;
    void loadMore();
  }, [recs, hasLoadedExtras, loadMore]);

  const handleRetire = useCallback((rideId: string) => {
    retireRide(rideId);
    setUndoToast({ rideId, key: Date.now() });
  }, [retireRide]);

  const header = (
    <GradientHeader
      title="More to Consider"
      subtitle="Additional recommendations for right now."
      back={{ label: 'Recommendations', onPress: () => navigation.goBack() }}
    />
  );

  if (!recs) {
    return (
      <SafeAreaView style={styles.container} testID="more-no-recs">
        {header}
        <StateBlock
          icon={<CircleAlert size={48} color={colors.textTertiary} />}
          title="No recommendations loaded"
          body="Head back to Recommendations to get fresh picks."
          action={{ label: 'Back', onPress: () => navigation.goBack() }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="more-loaded">
      {header}
      <FlatList
        data={extraRecs}
        keyExtractor={r => r.rideId}
        contentContainerStyle={[styles.listContent, extraRecs.length === 0 && styles.emptyContent]}
        renderItem={({ item }) => (
          <RecommendationCard
            rec={item}
            ride={ridesById.get(item.rideId)}
            debugMode={debugMode}
            onPress={() =>
              openDetail({
                rideId: item.rideId,
                type: null,
                source: 'browse',
                restrictionNote: item.restrictionNote,
                oneLiner: item.oneLiner ?? null,
              })
            }
            onRetire={() => handleRetire(item.rideId)}
          />
        )}
        ListEmptyComponent={
          loadingMore || loadMoreError || recs.hasMore ? null : (
            <StateBlock
              icon={<ListChecks size={48} color={colors.textTertiary} />}
              title="That's everything for now"
              body="Your top picks on Recommendations are the best moves right now."
              testID="more-empty"
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.loadingRow} testID="more-loading">
              <ActivityIndicator size="small" />
              <Text style={styles.loadingText}>Finding more picks…</Text>
            </View>
          ) : loadMoreError ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorBody}>{loadMoreError}</Text>
              <Pressable style={styles.moreButton} onPress={() => void loadMore()} testID="more-retry">
                <Text style={styles.moreButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : recs.hasMore ? (
            <Pressable style={styles.moreButton} onPress={() => void loadMore()} testID="more-show-more">
              <Text style={styles.moreButtonText}>Show More</Text>
            </Pressable>
          ) : null
        }
      />
      {undoToast ? (
        <UndoToast
          key={undoToast.key}
          message="Removed from list · Undo"
          onUndo={() => { unretireRide(undoToast.rideId); setUndoToast(null); }}
          onDismiss={() => setUndoToast(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing.base },
  emptyContent: { flexGrow: 1 },
  moreButton: {
    margin: spacing.base,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: colors.go,
    alignItems: 'center',
  },
  moreButtonText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.base,
    paddingVertical: 14,
    gap: spacing.sm,
  },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  errorRow: { margin: spacing.base, alignItems: 'center' },
  errorBody: { ...typography.caption, color: colors.skip, marginBottom: spacing.sm, textAlign: 'center' },
});
