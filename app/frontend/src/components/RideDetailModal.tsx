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

import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { AlertTriangle, X } from 'lucide-react-native';
import { colors } from '../theme/tokens';
import { Sheet } from './Sheet';
import { PaywallTeaser } from './PaywallTeaser';
import { PaywallScreen } from '../screens/PaywallScreen';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { useRides } from '../context/RideContext';
import { useLocation } from '../context/LocationContext';
import { usePersona } from '../context/PersonaContext';
import { useDebugMode } from '../context/DebugModeContext';
import { useDevice } from '../context/DeviceContext';
import { useTrip } from '../context/TripContext';
import { useRideNotificationHistory } from '../hooks/useRideNotificationHistory';
import { haversineMeters } from '../grouping';
import { isWalkOnRide } from '../utils/walkOn';
import { trendDirection } from '../utils/trendDirection';
import { isParkError, Ride } from '../types';
import { scheduleReopenReminder } from '../utils/scheduleReminder';

import { Tile, TileLabel } from './ride-detail/Tile';
import { RideDetailHeader } from './ride-detail/RideDetailHeader';
import { TodaysRange } from './ride-detail/TodaysRange';
import { TrendGraph } from './ride-detail/TrendGraph';
import { TrendCaption } from './ride-detail/TrendCaption';
import { ClosureTile } from './ride-detail/ClosureTile';
import { RideAlertHistory } from './ride-detail/RideAlertHistory';
import { FullDayForecast } from './ride-detail/FullDayForecast';

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
      size="xtall"
      backdropColor={active?.source === 'history' ? 'transparent' : undefined}
      headerRight={
        <Pressable onPress={dismissAll} hitSlop={12} testID="ride-detail-dismiss" style={styles.closeBtn}>
          <X size={18} color={colors.textSecondary} />
        </Pressable>
      }
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
}: {
  ride: Ride;
  parkName: string | null;
  userCoords: { lat: number; lng: number } | null;
  notifDurationMs: number | null;
  notifClosedAt: string | null;
  restrictionNote: string | null;
  oneLiner: string | null;
}): React.ReactElement {
  const { persona, setPersona } = usePersona();
  const { debugMode } = useDebugMode();
  const { deviceId } = useDevice();
  const { hasActiveTrip } = useTrip();
  const [paywallOpen, setPaywallOpen] = useState(false);

  const isOperating = ride.status === 'OPERATING';
  const isDown = ride.status === 'DOWN';
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait);
  const rawBadge = ride.score?.badge ?? null;
  // Star badge is a paid feature — downgrade to 'go' when no active trip.
  const badge = !hasActiveTrip && rawBadge === 'star' ? 'go' : rawBadge;

  const isWatching = persona ? persona.mustDoRideIds.includes(ride.id) : false;
  const onToggleWatch = () => {
    if (!persona) return;
    const next = isWatching
      ? persona.mustDoRideIds.filter(id => id !== ride.id)
      : [...persona.mustDoRideIds, ride.id];
    void setPersona({ ...persona, mustDoRideIds: next });
  };

  const handleNotifyReopen = async () => {
    if (!ride.predictedReopenAt) return;
    const result = await scheduleReopenReminder(ride.name, ride.predictedReopenAt);
    switch (result) {
      case 'scheduled':
        Alert.alert('Reminder set', `We'll notify you when ${ride.name} is about to reopen.`, [{ text: 'OK' }]);
        break;
      case 'denied':
        Alert.alert('Notifications off', 'Enable notifications for Club 32 in Settings to use reminders.', [{ text: 'OK' }]);
        break;
      case 'past':
        Alert.alert('Window may have passed', `The predicted reopen window for ${ride.name} may have already come and gone. Keep an eye on it.`, [{ text: 'OK' }]);
        break;
      // 'unsupported' (web) — no-op, button shouldn't appear on web
    }
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
  const bucket4Wait = buckets?.[4]?.wait ?? null;
  // When ML predictions are present, bucket0.wait is currentWait (not the
  // historical average). Use the baseline bucket0 for "typical" comparisons
  // (TodaysRange marker, DirectionCurve, trend caption) so we're comparing
  // current vs. history, not current vs. itself.
  const baselineBuckets = ride.historicalBaseline?.buckets;
  const bucket0Wait = (baselineBuckets?.[0]?.wait ?? buckets?.[0]?.wait) ?? null;

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
  const rideNotifs = useRideNotificationHistory(deviceId ?? null, ride.id);

  return (
    <BottomSheetScrollView contentContainerStyle={styles.body}>
      <Tile>
        <RideDetailHeader
          rideName={ride.name}
          parkName={parkName}
          land={ride.land}
          isOperating={isOperating}
          isDown={isDown}
          anchorWait={anchorWait}
          showWalkOn={showWalkOn}
          badge={badge}
          oneLiner={oneLiner}
          walkMins={walkMins}
          isWatching={isWatching}
          rideId={ride.id}
          trendDir={trendDir}
          bucket0Wait={bucket0Wait}
          bucket4Wait={bucket4Wait}
          onToggleWatch={onToggleWatch}
          hasActiveTrip={hasActiveTrip}
          postReopenWaitDrop={ride.closureProfile?.postReopenWaitDrop ?? false}
          downDurationMs={notifDurationMs}
          waitAtClose={null}
        />
        {restrictionNote ? (
          <View style={styles.restrictionBanner}>
            <AlertTriangle size={13} color={colors.star} style={styles.restrictionIcon} />
            <Text style={styles.restrictionText}>{restrictionNote}</Text>
          </View>
        ) : null}
      </Tile>

      {/* Closure tile — shown for DOWN rides only, outside the paywall gate
          so free users still see "Down since X". */}
      {isDown ? (
        <ClosureTile
          isDown={isDown}
          isPaid={hasActiveTrip}
          rideClosedAt={ride.closedAt ?? null}
          closureProfile={ride.closureProfile ?? null}
          predictedReopenAt={ride.predictedReopenAt ?? null}
          onNotifyReopen={handleNotifyReopen}
          onUnlock={() => setPaywallOpen(true)}
        />
      ) : null}

      {hasActiveTrip ? (
        <>
          {!isDown && ride.rideStats ? (
            <Tile>
              <TileLabel>Today's Range</TileLabel>
              <TodaysRange
                p10={ride.rideStats.p10}
                p90={ride.rideStats.p90}
                current={anchorWait}
                typicalWait={bucket0Wait}
              />
            </Tile>
          ) : null}

          {!isDown && ride.fullDayForecast ? (
            <Tile>
              <FullDayForecast fullDayForecast={ride.fullDayForecast} rideName={ride.name} />
            </Tile>
          ) : null}
        </>
      ) : (
        <>
          <PaywallTeaser onUnlock={() => setPaywallOpen(true)} />
          <Modal
            visible={paywallOpen}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setPaywallOpen(false)}
          >
            <PaywallScreen onClose={() => setPaywallOpen(false)} />
          </Modal>
        </>
      )}

      <RideAlertHistory entries={rideNotifs} />

      {debugMode && !isDown && ((ride.recentHistory && ride.recentHistory.length > 0) || buckets) ? (
        <Tile>
          <TileLabel>Trend (debug)</TileLabel>
          <TrendGraph
            recentHistory={ride.recentHistory ?? []}
            anchorWait={anchorWait}
            isDown={isDown}
            buckets={buckets ?? null}
            baselineBuckets={ride.historicalBaseline?.buckets ?? null}
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
    </BottomSheetScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 2, paddingBottom: 48, paddingHorizontal: 16 },

  restrictionBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.starBg,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    gap: 8,
  },
  restrictionIcon: { marginTop: 1 },
  restrictionText: { fontSize: 13, color: colors.textPrimary, flex: 1 },

  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  fallbackBlock: { flex: 1, justifyContent: 'center', padding: 32 },
  fallback: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
});
