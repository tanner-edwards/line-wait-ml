// Full-screen ride detail page — "the brain" of a ride.
//
// Layout (top → bottom):
//   1. Header: name + close, badge pill, land · park + wait/trend, walk + watch
//   2. Restriction note (when LLM flagged a persona conflict)
//   3. AI one-liner tile (when opened from Recommendations)
//   4. Today's Range tile — p10/p90 bar with current wait + typical marker
//   5. Trend tile — 7-column sparkline + plain-language caption
//   6. Closure tile — currently-down rides + recently reopened
//   7. Recent alerts tile — per-ride notification history
//   8. Scoring debug card (debug mode only)
//
// This file is the COORDINATOR. All visual pieces live in ./ride-detail/.
// The hook for fetching per-ride notification history lives in ../hooks/.
// Opened from a notification history-sheet row tap or service-worker
// deep-link via NotificationDetailContext.

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { colors } from '../theme/tokens';
import { Sheet } from './Sheet';
import { DebugCard } from './DebugCard';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { useRides } from '../context/RideContext';
import { useLocation } from '../context/LocationContext';
import { usePersona } from '../context/PersonaContext';
import { useDebugMode } from '../context/DebugModeContext';
import { useDevice } from '../context/DeviceContext';
import { useRideNotificationHistory } from '../hooks/useRideNotificationHistory';
import { haversineMeters } from '../grouping';
import { isWalkOnRide } from '../utils/walkOn';
import { trendDirection } from '../utils/trendDirection';
import { isParkError, Ride } from '../types';
import { MIN_BUCKET_SAMPLE_COUNT } from '../scoreConstants';

import { Tile } from './ride-detail/Tile';
import { RideDetailHeader } from './ride-detail/RideDetailHeader';
import { TodaysRange } from './ride-detail/TodaysRange';
import { TrendGraph } from './ride-detail/TrendGraph';
import { TrendCaption } from './ride-detail/TrendCaption';
import { ClosureTile } from './ride-detail/ClosureTile';
import { RideAlertHistory } from './ride-detail/RideAlertHistory';
import { FullDayForecast } from './ride-detail/FullDayForecast';

const SUBINK = '#666'; // TODO: tokenize

const WALK_SPEED_MPM = 83;
function walkPathMultiplier(m: number) {
  return m >= 640 ? 2.0 : m >= 366 ? 1.6 : 1.3;
}
function walkMinsBetween(
  origin: { lat: number; lng: number },
  ride: { lat: number | null; lng: number | null }
): number | null {
  if (ride.lat == null || ride.lng == null) return null;
  const raw = haversineMeters(origin.lat, origin.lng, ride.lat, ride.lng);
  return Math.max(1, Math.round((raw * walkPathMultiplier(raw)) / WALK_SPEED_MPM));
}

export function RideDetailModal(): React.ReactElement {
  const { active, closeDetail, dismissAll } = useNotificationDetail();
  const { ridesById, data } = useRides();
  const { coords } = useLocation();

  const ride = active ? ridesById.get(active.rideId) ?? null : null;
  const parkName = useMemo(() => {
    if (!ride || !data) return null;
    const entry = data.parks.find(
      p => !isParkError(p) && p.rides.some(r => r.id === ride.id)
    );
    return entry?.park ?? null;
  }, [ride, data]);

  return (
    <Sheet
      isOpen={active !== null}
      onClose={closeDetail}
      size="tall"
      backdropColor={active?.source === 'history' ? 'transparent' : undefined}
      testID="ride-detail"
    >
      {ride ? (
        <DetailBody
          ride={ride}
          parkName={parkName}
          userCoords={coords}
          notifDurationMs={active?.durationMs ?? null}
          notifClosedAt={active?.closedAt ?? null}
          restrictionNote={active?.restrictionNote ?? null}
          oneLiner={active?.oneLiner ?? null}
          onDismissAll={dismissAll}
        />
      ) : active ? (
        <View style={styles.fallbackBlock}>
          <Text style={styles.fallback}>
            That ride isn't in the current snapshot. Check the Browse tab for the latest status.
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}

function DetailBody({
  ride,
  parkName,
  userCoords,
  notifDurationMs,
  notifClosedAt,
  restrictionNote,
  oneLiner,
  onDismissAll,
}: {
  ride: Ride;
  parkName: string | null;
  userCoords: { lat: number; lng: number } | null;
  notifDurationMs: number | null;
  notifClosedAt: string | null;
  restrictionNote: string | null;
  oneLiner: string | null;
  onDismissAll: () => void;
}): React.ReactElement {
  const { persona, setPersona } = usePersona();
  const { debugMode } = useDebugMode();
  const { deviceId } = useDevice();

  const isOperating = ride.status === 'OPERATING';
  const isDown = ride.status === 'DOWN';
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait);
  const badge = ride.score?.badge ?? null;

  const isWatching = persona ? persona.mustDoRideIds.includes(ride.id) : false;
  const onToggleWatch = () => {
    if (!persona) return;
    const next = isWatching
      ? persona.mustDoRideIds.filter(id => id !== ride.id)
      : [...persona.mustDoRideIds, ride.id];
    void setPersona({ ...persona, mustDoRideIds: next });
  };

  // Wait at time of close — most recent OPERATING observation in recentHistory.
  const closedWait = useMemo(() => {
    if (!isDown || !ride.recentHistory) return null;
    const ops = ride.recentHistory
      .filter(h => h.status === 'OPERATING' && h.wait != null)
      .sort((a, b) => a.minutesAgo - b.minutesAgo);
    return ops[0]?.wait ?? null;
  }, [isDown, ride.recentHistory]);

  // The wait we plot as "now" — current for operating, wait-at-close for down.
  const anchorWait = isOperating ? ride.currentWait : closedWait;

  const buckets = ride.historicalAverage?.buckets;
  const bucket0Wait = buckets?.[0]?.wait ?? null;
  const bucket4Wait = buckets?.[4]?.wait ?? null;
  const bucket0SampleCount = buckets?.[0]?.sampleCount ?? 0;

  const isBelowNormal =
    isOperating && anchorWait !== null && bucket0Wait !== null &&
    bucket0Wait > 0 && bucket0SampleCount >= MIN_BUCKET_SAMPLE_COUNT &&
    anchorWait < bucket0Wait * 0.75;
  const isAboveNormal =
    isOperating && anchorWait !== null && bucket0Wait !== null &&
    bucket0Wait > 0 && bucket0SampleCount >= MIN_BUCKET_SAMPLE_COUNT &&
    anchorWait > bucket0Wait * 1.25;
  const waitColor = isBelowNormal ? colors.go : isAboveNormal ? colors.skip : '#222';

  // Star always wins; walkOn beats go/skip otherwise.
  const showWalkOn = walkOn && badge !== 'star';

  const walkMins = userCoords ? walkMinsBetween(userCoords, ride) : null;

  const trendDir = trendDirection({
    currentWait: anchorWait,
    recentWait: ride.recentHistory?.[0]?.wait ?? null,
    bucket1Wait: buckets?.[1]?.wait ?? null,
    bucket3Wait: buckets?.[3]?.wait ?? null,
    bucket4Wait,
  });
  const trendLabel = trendDir === 'down' ? 'Dropping ↘'
    : trendDir === 'up' ? 'Rising ↗'
    : trendDir === 'stable' ? 'Steady →'
    : null;
  const trendColor = trendDir === 'down' ? colors.go
    : trendDir === 'up' ? colors.skip
    : colors.textTertiary;

  const rideNotifs = useRideNotificationHistory(deviceId ?? null, ride.id);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <RideDetailHeader
        rideName={ride.name}
        parkName={parkName}
        land={ride.land}
        isDown={isDown}
        anchorWait={anchorWait}
        waitColor={waitColor}
        showWalkOn={showWalkOn}
        badge={badge}
        trendLabel={trendLabel}
        trendColor={trendColor}
        walkMins={walkMins}
        isWatching={isWatching}
        rideId={ride.id}
        oneLiner={oneLiner}
        onToggleWatch={onToggleWatch}
        onDismissAll={onDismissAll}
      />

      {restrictionNote ? (
        <View style={styles.restrictionBanner}>
          <AlertTriangle size={13} color={colors.star} style={styles.restrictionIcon} />
          <Text style={styles.restrictionText}>{restrictionNote}</Text>
        </View>
      ) : null}

      {/* Closure tile surfaces first when ride is down — all other data is secondary. */}
      {isDown ? (
        <ClosureTile
          isDown={isDown}
          rideClosedAt={ride.closedAt ?? null}
          notifClosedAt={notifClosedAt}
          notifDurationMs={notifDurationMs}
        />
      ) : null}

      {!isDown && ride.rideStats ? (
        <Tile>
          <TodaysRange
            p10={ride.rideStats.p10}
            p90={ride.rideStats.p90}
            current={anchorWait}
            typicalWait={bucket0Wait}
          />
        </Tile>
      ) : null}

      {!isDown && ((ride.recentHistory && ride.recentHistory.length > 0) || buckets) ? (
        <Tile>
          <TrendGraph
            recentHistory={ride.recentHistory ?? []}
            anchorWait={anchorWait}
            isDown={isDown}
            buckets={buckets ?? null}
          />
          <TrendCaption
            anchorWait={anchorWait}
            isDown={isDown}
            recentWait={ride.recentHistory?.[0]?.wait ?? null}
            bucket1Wait={buckets?.[1]?.wait ?? null}
            bucket3Wait={buckets?.[3]?.wait ?? null}
            bucket4Wait={bucket4Wait}
          />
        </Tile>
      ) : null}

      {/* Reopen case: ride is back up but recently reopened — show closure context near bottom. */}
      {!isDown ? (
        <ClosureTile
          isDown={isDown}
          rideClosedAt={ride.closedAt ?? null}
          notifClosedAt={notifClosedAt}
          notifDurationMs={notifDurationMs}
        />
      ) : null}

      {ride.fullDayForecast ? (
        <Tile>
          <FullDayForecast fullDayForecast={ride.fullDayForecast} rideName={ride.name} />
        </Tile>
      ) : null}

      <RideAlertHistory entries={rideNotifs} />

      {debugMode && ride.score ? (
        <View style={styles.debugSection}>
          <Text style={styles.debugSectionLabel}>Scoring (debug)</Text>
          <DebugCard ride={ride} result={ride.score} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 4, paddingBottom: 48 },

  restrictionBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.starBg,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  restrictionIcon: { marginTop: 1 },
  restrictionText: { fontSize: 13, color: '#222', flex: 1 },

  debugSection: { marginTop: 16 },
  debugSectionLabel: {
    fontSize: 11,
    color: SUBINK,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    fontWeight: '600',
    paddingHorizontal: 4,
  },

  fallbackBlock: { flex: 1, justifyContent: 'center', padding: 32 },
  fallback: { fontSize: 14, color: SUBINK, textAlign: 'center' },
});
