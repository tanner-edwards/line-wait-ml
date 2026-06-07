// Full-screen ride detail page — "the brain" of a ride.
//
// Layout (top → bottom):
//   1. Title: name + land · park
//   2. Status row: current wait (or "Closed"), badge if any, below/above-
//      normal pill — all horizontal on one line.
//   3. Trend tile: SVG line graph showing past observations + now + the
//      typical curve for the next 2 hours. For DOWN rides, the past
//      segment ends at closure and the future segment is grayed because
//      we don't know yet when it'll reopen.
//   4. Range tile: |─●─| band of p10..p90 with the current wait dot.
//      If current is outside the band, the bar extends with a dashed
//      tail to keep the dot reachable. Labels stack vertically to avoid
//      overlap when the dot sits near an endpoint.
//   5. Right now tile: current wait vs typical-at-this-hour, with a
//      directional arrow + percent delta.
//   6. (DOWN only) Closure tile: when it went down + how long ago, and
//      a placeholder for the eventual reopen-prediction model.
//
// Opened from a notification history-sheet row tap (G2a) or a service
// worker deep-link (G2b). Back button closes; the context restores the
// history sheet if that's where the user came from.
//
// TODO: migrate to tall Sheet (needs review). Strong candidate for size="tall"
// (~90% snap) to get flick-down-to-dismiss instead of a hard page jump. When
// doing this, preserve all content exactly and change only the container.
// Ref: club32-design-system-phase2.md §1 "Flagged decision — RideDetailModal".

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { colors } from '../theme/tokens';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Bell, CircleCheck, OctagonX, Star, X } from 'lucide-react-native';
import { Sheet } from './Sheet';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { useRides } from '../context/RideContext';
import { useLocation } from '../context/LocationContext';
import { usePersona } from '../context/PersonaContext';
import { useDebugMode } from '../context/DebugModeContext';
import { useDevice } from '../context/DeviceContext';
import { DebugCard } from './DebugCard';
import { haversineMeters } from '../grouping';
import { formatBucketTimeSlot, formatHHMM, formatTimeAgo } from '../timestamp';
import { formatDuration, notificationBody } from '../../../../notification-copy';
import { RecommendationBadge } from './RecommendationBadge';
import { TrendArrow } from './TrendArrow';
import { isWalkOnRide } from '../utils/walkOn';
import { fetchDeviceNotifications } from '../api';
import { getCachedNotifications } from '../utils/notificationHistoryStorage';
import { isParkError, NotificationLogEntry, Ride } from '../types';
import { MIN_BUCKET_SAMPLE_COUNT } from '../scoreConstants';

const BRAND = colors.brand;
const BRAND_DIM = '#a3a5e4'; // TODO: tokenize
const MUTED = '#bbb'; // TODO: tokenize
const GREEN = colors.go;
const RED = colors.skip;
const INK = '#222'; // TODO: tokenize
const SUBINK = '#666'; // TODO: tokenize

const WALK_SPEED_MPM = 83;
function walkPathMultiplier(m: number) {
  return m >= 640 ? 2.0 : m >= 366 ? 1.6 : 1.3;
}
function reopenedWithinLastHour(closedAt: string | null, durationMs: number | null): boolean {
  if (!closedAt || durationMs == null) return false;
  const reopenTime = new Date(closedAt).getTime() + durationMs;
  return Date.now() - reopenTime < 60 * 60_000;
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
      headerRight={
        <Pressable
          onPress={dismissAll}
          hitSlop={12}
          testID="ride-detail-dismiss"
        >
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
}: {
  ride: Ride;
  parkName: string | null;
  userCoords: { lat: number; lng: number } | null;
  notifDurationMs: number | null;
  notifClosedAt: string | null;
}): React.ReactElement {
  const isOperating = ride.status === 'OPERATING';
  const isDown = ride.status === 'DOWN';
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait);
  const badge = ride.score?.badge ?? null;

  const { persona, setPersona } = usePersona();
  const { debugMode } = useDebugMode();
  const { deviceId } = useDevice();
  const isWatching = persona ? persona.mustDoRideIds.includes(ride.id) : false;
  const onToggleWatch = () => {
    if (!persona) return;
    const next = isWatching
      ? persona.mustDoRideIds.filter(id => id !== ride.id)
      : [...persona.mustDoRideIds, ride.id];
    void setPersona({ ...persona, mustDoRideIds: next });
  };

  const buckets = ride.historicalAverage?.buckets;
  const bucket0Wait = buckets?.[0]?.wait ?? null;

  // Wait at time of close — for a DOWN ride, find the most recent
  // OPERATING observation in recentHistory. We display this where the
  // current wait would be ("45 min at time of close").
  const closedWait = useMemo(() => {
    if (!isDown || !ride.recentHistory) return null;
    const ops = ride.recentHistory
      .filter(h => h.status === 'OPERATING' && h.wait != null)
      .sort((a, b) => a.minutesAgo - b.minutesAgo);
    return ops[0]?.wait ?? null;
  }, [isDown, ride.recentHistory]);

  // The wait we plot as "now" — current for operating, wait-at-close for
  // down rides. Falls back to null when neither is available.
  const anchorWait = isOperating ? ride.currentWait : closedWait;

  const walkMins = userCoords ? walkMinsBetween(userCoords, ride) : null;
  const aboveBelow = computeAboveBelow(anchorWait, bucket0Wait);
  const bucket4Wait = buckets?.[4]?.wait ?? null;
  const lowConfidence = (buckets?.[0]?.sampleCount ?? 0) < MIN_BUCKET_SAMPLE_COUNT;
  // Badge precedence matches the list: star > walkOn > go > skip. The detail
  // header shows the precise minute number (not a "Walk On" label), but it
  // suppresses the go/skip badge when the ride is a walk-on, same as the row.
  const showBadge = badge !== null && !(walkOn && badge !== 'star');

  // Per-ride notification history — latest entry per type for this ride.
  //
  // TRIAL: We're using the latest-per-type overwrite model (notification_log
  // doc ID = deviceId__rideId__type, overwritten each cooldown cycle). This
  // means at most 4 entries per ride ever appear here. If this tile proves
  // useful, replace with an append-only notification_history collection so
  // users see a real audit log. For now this is good enough to validate the
  // feature. — unknown date, flagged for follow-up.
  const [rideNotifs, setRideNotifs] = useState<NotificationLogEntry[]>([]);
  const loadRideNotifs = useCallback(async () => {
    if (!deviceId) return;
    const cached = await getCachedNotifications(deviceId);
    const base = cached ?? [];
    const filtered = base.filter(e => e.rideId === ride.id);
    if (filtered.length) setRideNotifs(filtered);
    try {
      const fresh = await fetchDeviceNotifications(deviceId);
      setRideNotifs(fresh.filter(e => e.rideId === ride.id));
    } catch {
      // already showing cached or nothing — silent fail
    }
  }, [deviceId, ride.id]);
  useEffect(() => { void loadRideNotifs(); }, [loadRideNotifs]);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {/* Header block — ride name + subtitle tight pair, then wait/badge/trend */}
      <View style={styles.headerBlock}>
        <Text style={styles.rideName}>{ride.name}</Text>
        {/* Row 1: subtitle | wait number (4px below name) */}
        <View style={styles.headerRow1}>
          <Text style={styles.subtitle}>
            {ride.land}{parkName ? ` · ${parkName}` : ''}
          </Text>
          <View style={styles.waitCluster}>
            {isDown ? (
              <View style={styles.waitWithAnnotation}>
                <Text style={styles.statusClosed}>Closed</Text>
                {anchorWait !== null ? (
                  <Text style={styles.waitAnnotation}>{anchorWait} min at close</Text>
                ) : null}
              </View>
            ) : anchorWait !== null ? (
              <View style={styles.waitWithAnnotation}>
                <View style={styles.waitNumberRow}>
                  <Text style={styles.statusWait}>{anchorWait}</Text>
                  <Text style={styles.statusWaitUnit}> min</Text>
                </View>
                {walkOn ? (
                  <Text style={styles.waitAnnotation}>Walk On</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.statusOther}>{ride.status}</Text>
            )}
          </View>
        </View>

        {/* Row 2: aboveBelow | trend (badge moved up next to name) */}
        <View style={styles.headerRow2}>
          <View style={styles.headerLeft}>
            {aboveBelow ? (
              <View style={[styles.abovebelowPill, { backgroundColor: aboveBelow.pillBg }]}>
                <Text style={[styles.abovebelowText, { color: aboveBelow.color }]}>
                  {aboveBelow.shortLabel}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.trendCluster}>
            {bucket0Wait != null && bucket4Wait != null ? (
              <>
                <Text style={styles.trendLabel}>
                  {bucket4Wait < bucket0Wait * 0.9 ? 'Dropping'
                    : bucket4Wait > bucket0Wait * 1.1 ? 'Rising'
                    : 'Steady'}
                </Text>
                <TrendArrow
                  bucket0Wait={bucket0Wait}
                  bucket2Wait={bucket4Wait}
                  lowConfidence={lowConfidence}
                />
              </>
            ) : null}
          </View>
        </View>

        {/* Row 3: walk distance (left) + notify pill (right) */}
        <View style={styles.walkNotifyRow}>
          {walkMins != null ? (
            <View style={styles.walkPill}>
              <Text style={styles.walkPillText}>~{walkMins} min walk</Text>
            </View>
          ) : <View />}
          <Pressable
            onPress={onToggleWatch}
            style={({ pressed }) => [styles.notifyPill, isWatching && styles.notifyPillActive, pressed && styles.notifyPillPressed]}
            hitSlop={8}
            testID={`detail-bell-${ride.id}`}
            accessibilityRole="button"
            accessibilityLabel={isWatching ? 'Remove alert' : 'Set alert'}
          >
            <Bell size={12} color={isWatching ? colors.brand : colors.textTertiary} />
            <Text style={[styles.notifyPillText, isWatching && styles.notifyPillTextActive]}>
              {isWatching ? 'Watching' : 'Notify'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Right-now tile — moved ABOVE the graph since the current-vs-typical
          comparison is the most decision-relevant single number on the page. */}
      {bucket0Wait != null ? (
        <Tile>
          <TileLabel>Right now vs typical</TileLabel>
          <Text style={styles.rightNowLine}>
            <Text style={styles.rightNowNumber}>
              {isDown ? 'Closed' : (anchorWait != null ? `${anchorWait} min` : '—')}
            </Text>
            <Text style={styles.rightNowDim}> · usually ~{bucket0Wait} min around now</Text>
          </Text>
          {aboveBelow ? (
            <Text style={[styles.rightNowDelta, { color: aboveBelow.color }]}>
              {aboveBelow.arrow} {Math.abs(aboveBelow.percent)}% {aboveBelow.percent < 0 ? 'below' : 'above'} typical
            </Text>
          ) : null}
        </Tile>
      ) : null}

      {/* Trend graph — full-width hero, taller so the Y axis is readable. */}
      {(ride.recentHistory && ride.recentHistory.length > 0) || buckets ? (
        <Tile>
          <TileLabel>Trend</TileLabel>
          <TrendGraph
            recentHistory={ride.recentHistory ?? []}
            anchorWait={anchorWait}
            isDown={isDown}
            buckets={buckets ?? null}
          />
          <TrendCaption
            anchorWait={anchorWait}
            isDown={isDown}
            futureBuckets={buckets ?? null}
          />
        </Tile>
      ) : null}

      {/* Range band — min/max range with current marker */}
      {ride.rideStats ? (
        <Tile>
          <TileLabel>Where it sits in this ride's range</TileLabel>
          <RangeBand
            p10={ride.rideStats.p10}
            p90={ride.rideStats.p90}
            current={anchorWait}
            isDown={isDown}
          />
        </Tile>
      ) : null}

      {/* Closure tile — always shown for currently-down rides; for reopened
          rides, only shown within 1 hour of the reopen (info is decision-
          relevant while the crowd is still catching on, trivia after that). */}
      {(isDown || reopenedWithinLastHour(notifClosedAt, notifDurationMs)) ? (
        <Tile>
          <TileLabel>Closure</TileLabel>
          {/* Currently-down ride: show when it closed + live duration. */}
          {isDown && ride.closedAt ? (
            <>
              <Text style={styles.closureLine}>
                Closed at <Text style={styles.bold}>{formatHHMM(ride.closedAt)}</Text>
              </Text>
              <Text style={styles.closureLine}>
                Down for <Text style={styles.bold}>{formatTimeAgo(ride.closedAt)}</Text>
              </Text>
            </>
          ) : isDown ? (
            <Text style={styles.closureLine}>Currently down.</Text>
          ) : null}
          {/* Reopened ride: show closed-at + total downtime from the log entry. */}
          {!isDown && notifClosedAt ? (
            <Text style={styles.closureLine}>
              Closed at <Text style={styles.bold}>{formatHHMM(notifClosedAt)}</Text>
            </Text>
          ) : null}
          {notifDurationMs != null ? (
            <Text style={styles.closureLine}>
              Was down for{' '}
              <Text style={styles.bold}>{formatDuration(notifDurationMs) ?? `${Math.round(notifDurationMs / 60_000)} min`}</Text>
            </Text>
          ) : null}
          {isDown ? (
            <Text style={styles.closureFutureHint}>
              Reopen estimate — coming soon.
            </Text>
          ) : null}
        </Tile>
      ) : null}

      {/* Per-ride notification history — latest alert per type for this ride.
          See the TRIAL comment above loadRideNotifs for schema limitations. */}
      {rideNotifs.length > 0 ? (
        <Tile>
          <TileLabel>Recent alerts</TileLabel>
          {rideNotifs.map(entry => {
            const notifIcon = entry.type === 'closure' ? <OctagonX size={16} color={colors.skip} />
              : entry.type === 'peak'    ? <OctagonX size={16} color={colors.star} />
              : entry.type === 'reopen'  ? <CircleCheck size={16} color={colors.go} />
              : entry.badge === 'star'   ? <Star size={16} color={colors.star} fill={colors.star} />
              : <CircleCheck size={16} color={colors.go} />;
            const body = entry.body ?? notificationBody(entry);
            return (
              <View key={`${entry.type}-${entry.firedAt}`} style={styles.notifHistoryRow}>
                <View style={styles.notifHistoryIcon}>{notifIcon}</View>
                <View style={styles.notifHistoryText}>
                  <Text style={styles.notifHistoryBody}>{body}</Text>
                </View>
                <Text style={styles.notifHistoryWhen}>{formatTimeAgo(entry.firedAt)}</Text>
              </View>
            );
          })}
        </Tile>
      ) : null}

      {/* Scoring breakdown — debug-only. Same DebugCard the Browse list
          expands inline; reusing it keeps the scoring view consistent
          everywhere. */}
      {debugMode && ride.score ? (
        <View style={styles.debugSection}>
          <Text style={styles.debugSectionLabel}>Scoring (debug)</Text>
          <DebugCard ride={ride} result={ride.score} />
        </View>
      ) : null}

    </ScrollView>
  );
}

// ---- Trend graph (SVG) --------------------------------------------
//
// Mirrors the inline DebugCard sparkline approach: 7 evenly-spaced
// columns (t-40, t-20, now, +30, +60, +90, +120). Per column we show a
// time label + the wait number above the sparkline. Auto-scaled Y axis
// based on the actual values plotted. The "now" point gets a slightly
// larger dot to anchor visual attention.

const GRAPH_RENDER_H = 90;
const COLUMN_COUNT = 7;

function TrendGraph({
  recentHistory,
  anchorWait,
  isDown,
  buckets,
}: {
  recentHistory: { timestamp: string; minutesAgo: number; wait: number | null; status: string }[];
  anchorWait: number | null;
  isDown: boolean;
  buckets: { offsetMinutes: number; timeSlot: string; wait: number | null; sampleCount: number }[] | null;
}): React.ReactElement {
  // Pull the ~20-min-ago and ~40-min-ago observations from recentHistory.
  // The backend returns up to 4 entries most-recent-first at 10-min cron
  // intervals, so [1] ≈ 20 min ago and [3] ≈ 40 min ago. Skipping [0] and
  // [2] gives 20-min visual steps that match the 40-min lookback intent.
  const tMinus20 = recentHistory[1] ?? null;
  const tMinus40 = recentHistory[3] ?? null;

  // Seven evenly-spaced columns. nowIdx is the "now" position; values
  // before it are actuals, after are typical-at-this-hour.
  const nowIdx = 2;

  // If we're within 5 minutes of the next 30-min slot, shift all future
  // bucket indices forward by one: use buckets[2..5] instead of buckets[1..4].
  // This avoids the unrealistic drop (e.g. -15 min in 2 minutes) AND keeps
  // the full 2-hour lookahead intact by consuming the new t+150 bucket.
  // The backend always returns 6 buckets (t+0..t+150) for exactly this reason.
  const minutesUntilNextSlot = 30 - (new Date().getMinutes() % 30);
  const clamping = minutesUntilNextSlot <= 5;
  // fi(i) maps future column i (0=+30, 1=+60, 2=+90, 3=+120) to buckets index.
  const fi = (i: number) => i + 1 + (clamping ? 1 : 0);

  const values: (number | null)[] = [
    tMinus40?.status === 'OPERATING' ? tMinus40.wait : null,
    tMinus20?.status === 'OPERATING' ? tMinus20.wait : null,
    anchorWait,
    buckets?.[fi(0)]?.wait ?? null,
    buckets?.[fi(1)]?.wait ?? null,
    buckets?.[fi(2)]?.wait ?? null,
    buckets?.[fi(3)]?.wait ?? null,
  ];
  const columnLabels: string[] = [
    formatHHMM(tMinus40?.timestamp ?? null),
    formatHHMM(tMinus20?.timestamp ?? null),
    'now',
    buckets?.[fi(0)]?.timeSlot ? formatBucketTimeSlot(buckets[fi(0)].timeSlot) : '+30m',
    buckets?.[fi(1)]?.timeSlot ? formatBucketTimeSlot(buckets[fi(1)].timeSlot) : '+1h',
    buckets?.[fi(2)]?.timeSlot ? formatBucketTimeSlot(buckets[fi(2)].timeSlot) : '+90m',
    buckets?.[fi(3)]?.timeSlot ? formatBucketTimeSlot(buckets[fi(3)].timeSlot) : '+2h',
  ];

  // Measure the actual rendered width — react-native-svg's width="100%"
  // doesn't always expand correctly on Expo Web. Pass a real pixel value.
  const [renderW, setRenderW] = useState(0);
  // The header above the SVG uses flex columns (each renderW/7 wide,
  // text centered inside each). To stay aligned, dots sit at the CENTER
  // of their column, not at PAD_X + i * step (which would track edges
  // of the inner width, not column centers — that was the misalignment).
  // Vertical padding still needed so dots at the extremes don't clip.
  const PAD_Y = 8;
  const innerH = GRAPH_RENDER_H - PAD_Y * 2;
  const colWidth = renderW > 0 ? renderW / COLUMN_COUNT : 0;
  const xAt = (i: number) => (i + 0.5) * colWidth;

  // Auto-scale Y based on actuals present.
  const valid = values.filter((v): v is number => v != null);
  const minV = valid.length ? Math.min(...valid) : 0;
  const maxV = valid.length ? Math.max(...valid) : 1;
  const range = maxV - minV || 1;
  const toY = (v: number) => PAD_Y + innerH - ((v - minV) / range) * innerH;

  // Build polyline strings, splitting on null gaps so the line skips them.
  // We always transition past→future at nowIdx even if there's only one past
  // point — the old `cur.length >= 2` guard meant rides with no recentHistory
  // never flipped segIsPast, so future dots were drawn solid instead of dashed.
  const pastSegments: string[] = [];
  const futureSegments: string[] = [];
  let cur: string[] = [];
  let segIsPast = true;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      if (cur.length >= 2) (segIsPast ? pastSegments : futureSegments).push(cur.join(' '));
      cur = [];
      if (i === nowIdx) segIsPast = false;
      continue;
    }
    cur.push(`${xAt(i)},${toY(v)}`);
    if (i === nowIdx) {
      if (cur.length >= 2) pastSegments.push(cur.join(' '));
      cur = [`${xAt(i)},${toY(v)}`];
      segIsPast = false;
    }
  }
  if (cur.length >= 2) (segIsPast ? pastSegments : futureSegments).push(cur.join(' '));

  return (
    <View onLayout={e => setRenderW(Math.round(e.nativeEvent.layout.width))}>
      {/* Column header: time labels + wait values */}
      <View style={styles.columnsRow}>
        {values.map((v, i) => (
          <View key={`col-${i}`} style={styles.column}>
            <Text style={[styles.columnLabel, i === nowIdx && styles.columnLabelNow]} numberOfLines={1}>
              {columnLabels[i]}
            </Text>
            <Text style={[styles.columnValue, i === nowIdx && styles.columnValueNow]}>
              {v == null ? '—' : v}
            </Text>
          </View>
        ))}
      </View>

      {/* Sparkline */}
      <View style={{ height: GRAPH_RENDER_H }}>
        {renderW > 0 && valid.length >= 2 ? (
          <Svg width={renderW} height={GRAPH_RENDER_H}>
            {pastSegments.map((p, i) => (
              <Polyline key={`past-${i}`} points={p} fill="none" stroke={BRAND} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {futureSegments.map((p, i) => (
              <Polyline key={`future-${i}`} points={p} fill="none" stroke={isDown ? MUTED : BRAND_DIM} strokeWidth={2} strokeDasharray="4,4" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {values.map((v, i) =>
              v == null ? null : (
                <Circle
                  key={`dot-${i}`}
                  cx={xAt(i)}
                  cy={toY(v)}
                  r={i === nowIdx ? 5 : 3}
                  fill={i === nowIdx ? '#fff' /* TODO: tokenize */ : (i < nowIdx ? BRAND : BRAND_DIM)}
                  stroke={i === nowIdx ? (isDown ? RED : BRAND) : 'none'}
                  strokeWidth={i === nowIdx ? 2 : 0}
                />
              )
            )}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

function TrendCaption({
  anchorWait,
  isDown,
  futureBuckets,
}: {
  anchorWait: number | null;
  isDown: boolean;
  futureBuckets: { offsetMinutes: number; wait: number | null }[] | null;
}): React.ReactElement | null {
  if (isDown) {
    return <Text style={styles.tinyHint}>Future grayed — we don't have a reopen estimate yet.</Text>;
  }
  if (anchorWait == null || !futureBuckets) return null;
  const b120 = futureBuckets.find(b => b.offsetMinutes === 120)?.wait;
  if (b120 == null) return null;
  const delta = b120 - anchorWait;
  if (Math.abs(delta) < 5) {
    return <Text style={styles.tinyHint}>Roughly flat over the next 2 hours.</Text>;
  }
  if (delta > 0) {
    return <Text style={styles.tinyHint}>Trending up over the next 2 hours — sooner is better.</Text>;
  }
  return <Text style={styles.tinyHint}>Trending down — a better window may be coming.</Text>;
}

// "Nice" Y axis step — pick the smallest tick increment from a fixed
// candidate set that yields ≤6 ticks across the data range. Keeps the
// gridline count readable across short-wait and headliner-wait rides.
function niceTickStep(max: number): number {
  const candidates = [5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 200];
  for (const c of candidates) {
    if (max / c <= 6) return c;
  }
  return Math.ceil(max / 5);
}

// ---- Range band (SVG p10 – p90) -----------------------------------

// Tall, chunky band — the visual is a single horizontal value, so vertical
// height is all about giving the bar + dot + labels real presence rather
// than a thin strip.
const RB_W = 360;
const RB_H = 80;
const RB_RENDER_H = 80;
// Side padding kept small so the bar genuinely spans the screen in the
// happy path. End-cap labels are anchored at bandStart/bandEnd so they
// follow the bar position even when it shifts for an out-of-band dot.
const RB_PAD_X = 16;
const RB_BAR_Y = 36;

function RangeBand({
  p10,
  p90,
  current,
  isDown,
}: {
  p10: number;
  p90: number;
  current: number | null;
  isDown: boolean;
}): React.ReactElement {
  // Layout model:
  //  • Happy path (p10 ≤ current ≤ p90): the bar spans the full inner width.
  //    The dot sits on the bar proportionally between the end-caps.
  //  • Below p10: the bar shifts right to make room for a green dashed
  //    extension on the left. Extension length is proportional to how
  //    far below the value is, capped at MAX_EXTENSION_FRAC of total
  //    width so the band itself never shrinks below ~70%.
  //  • Above p90: mirror — bar shifts left, red dashed extension on right.
  //  • The bar is just lines (end-caps + a connector) with no interior
  //    fill — keeps the "|—————|" feel clean.

  const innerLeft = RB_PAD_X;
  const innerRight = RB_W - RB_PAD_X;
  const totalW = innerRight - innerLeft;
  const MAX_EXTENSION_FRAC = 0.30;
  const maxExtension = totalW * MAX_EXTENSION_FRAC;
  const range = Math.max(1, p90 - p10);

  let bandStart = innerLeft;
  let bandEnd = innerRight;
  let dotX: number | null = null;
  let dotColor: string = isDown ? RED : BRAND;
  let extension: { x1: number; x2: number; color: string } | null = null;

  if (current != null) {
    if (current >= p10 && current <= p90) {
      // Happy path — full-width bar, dot proportionally placed.
      const ratio = (current - p10) / range;
      dotX = innerLeft + ratio * totalW;
    } else if (current < p10) {
      // Below band — bar shifts right, green dashed extension on the left.
      const outRatio = Math.min(1, (p10 - current) / range);
      const extW = outRatio * maxExtension;
      bandStart = innerLeft + extW;
      bandEnd = innerRight;
      dotX = innerLeft;
      dotColor = GREEN;
      extension = { x1: innerLeft, x2: bandStart, color: GREEN };
    } else {
      // Above band — bar shifts left, red dashed extension on the right.
      const outRatio = Math.min(1, (current - p90) / range);
      const extW = outRatio * maxExtension;
      bandStart = innerLeft;
      bandEnd = innerRight - extW;
      dotX = innerRight;
      dotColor = RED;
      extension = { x1: bandEnd, x2: innerRight, color: RED };
    }
  }

  const bandY = RB_BAR_Y;
  // Measure container width — see TrendGraph for the same rationale.
  const [renderW, setRenderW] = useState(0);
  return (
    <View
      style={styles.rangeWrap}
      onLayout={e => setRenderW(Math.round(e.nativeEvent.layout.width))}
    >
      {renderW > 0 ? (
      <Svg
        width={renderW}
        height={RB_RENDER_H}
        viewBox={`0 0 ${RB_W} ${RB_H}`}
        preserveAspectRatio="none"
      >
        {/* Out-of-band dashed extension (green for below, red for above) */}
        {extension ? (
          <Line
            x1={extension.x1} x2={extension.x2}
            y1={bandY} y2={bandY}
            stroke={extension.color} strokeWidth={1.5} strokeDasharray="4,3"
            strokeLinecap="round"
          />
        ) : null}

        {/* The bar itself — left cap, connector, right cap. Thin & clean. */}
        <Line x1={bandStart} x2={bandStart} y1={bandY - 7} y2={bandY + 7} stroke={BRAND_DIM} strokeWidth={1.5} strokeLinecap="round" />
        <Line x1={bandEnd}   x2={bandEnd}   y1={bandY - 7} y2={bandY + 7} stroke={BRAND_DIM} strokeWidth={1.5} strokeLinecap="round" />
        <Line x1={bandStart} x2={bandEnd}   y1={bandY}     y2={bandY}     stroke={BRAND_DIM} strokeWidth={1.5} strokeLinecap="round" />

        {/* min / max labels under the end-caps — value on one row, label on the next */}
        <SvgText x={bandStart} y={bandY + 21} fontSize="13" fontWeight="600" fill={INK} textAnchor="middle">{p10}</SvgText>
        <SvgText x={bandStart} y={bandY + 35} fontSize="11" fill={MUTED} textAnchor="middle">min</SvgText>
        <SvgText x={bandEnd}   y={bandY + 21} fontSize="13" fontWeight="600" fill={INK} textAnchor="middle">{p90}</SvgText>
        <SvgText x={bandEnd}   y={bandY + 35} fontSize="11" fill={MUTED} textAnchor="middle">max</SvgText>

        {/* Current-wait dot + value label above. Small dot, light typography. */}
        {dotX != null && current != null ? (
          <>
            <Circle cx={dotX} cy={bandY} r={6} fill={dotColor} />
            <SvgText x={dotX} y={bandY - 12} fontSize="13" fontWeight="600" fill={INK} textAnchor="middle">
              {current}
            </SvgText>
          </>
        ) : null}
      </Svg>
      ) : null}
    </View>
  );
}

// ---- Tiles & small helpers ----------------------------------------

function Tile({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View style={styles.tile}>{children}</View>;
}

function TileLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text style={styles.tileLabel}>{children}</Text>;
}

interface AboveBelow {
  percent: number;
  arrow: '↘' | '↗' | '→';
  color: string;
  pillBg: string;
  shortLabel: string;
}

function computeAboveBelow(current: number | null, typical: number | null): AboveBelow | null {
  if (current == null || typical == null || typical === 0) return null;
  const delta = (current - typical) / typical;
  const percent = Math.round(delta * 100);
  if (Math.abs(percent) < 10) {
    return { percent, arrow: '→', color: SUBINK, pillBg: '#f4f4f4' /* TODO: tokenize */, shortLabel: 'Typical' };
  }
  if (percent < 0) {
    return { percent, arrow: '↘', color: GREEN, pillBg: '#e6f7e9' /* TODO: tokenize */, shortLabel: 'Below typical' };
  }
  return { percent, arrow: '↗', color: RED, pillBg: '#fde2e2' /* TODO: tokenize */, shortLabel: 'Above typical' };
}

const styles = StyleSheet.create({
  body: { paddingTop: 4, paddingBottom: 48 },

  headerBlock: {
    marginBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  titleBadge: {
    // Vertical nudge so the badge optically aligns with the first line
    // of the larger Lora display name rather than sitting baseline-high.
    marginTop: 5,
  },
  rideName: {
    fontFamily: 'Lora_700Bold',
    fontSize: 22,
    fontWeight: '700',
    color: INK,
    lineHeight: 28,
    flex: 1,
  },
  headerRow1: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 4, // tight gap between name and subtitle
    marginBottom: 6,
  },
  subtitle: { fontSize: 13, color: SUBINK, flexShrink: 1, marginRight: 8 },
  waitCluster: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 1,
    flexShrink: 0,
  },
  statusWait: { fontSize: 36, fontWeight: '700', fontFamily: 'Outfit_700Bold', color: INK },
  statusWaitUnit: { fontSize: 16, fontWeight: '500', color: SUBINK },
  statusClosed: { fontSize: 32, fontWeight: '700', fontFamily: 'Outfit_700Bold', color: RED },
  statusOther: { fontSize: 14, fontWeight: '600', color: SUBINK },
  waitWithAnnotation: { alignItems: 'flex-end' },
  waitNumberRow: { flexDirection: 'row', alignItems: 'baseline', gap: 1 },
  waitAnnotation: { fontSize: 10, color: RED, marginTop: -2 },
  headerRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    flexWrap: 'wrap',
  },
  walkNotifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  notifyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  notifyPillActive: {
    borderColor: colors.brand,
    backgroundColor: colors.bg,
  },
  notifyPillPressed: { opacity: 0.7 },
  notifyPillText: { fontSize: 12, color: colors.textTertiary, fontWeight: '500' },
  notifyPillTextActive: { color: colors.brand, fontWeight: '600' },
  abovebelowPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  abovebelowText: { fontSize: 11, fontWeight: '700' },
  trendCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendLabel: {
    fontSize: 12,
    color: SUBINK,
    marginRight: 2,
  },
  walkPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  walkPillText: { fontSize: 12, color: BRAND, fontWeight: '600' },

  tile: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
    borderColor: '#eef', // TODO: tokenize
    borderWidth: 1,
  },
  tileLabel: {
    fontSize: 11,
    color: SUBINK,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    fontWeight: '600',
  },
  tileBody: { fontSize: 14, color: INK, lineHeight: 20 },

  graphWrap: { alignItems: 'stretch', minHeight: GRAPH_RENDER_H, width: '100%' },
  columnsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 6,
  },
  column: { flex: 1, alignItems: 'center' },
  columnLabel: { fontSize: 10, color: SUBINK },
  columnLabelNow: { color: BRAND, fontWeight: '700' },
  columnValue: { fontSize: 13, fontWeight: '600', color: INK, marginTop: 1 },
  columnValueNow: { color: BRAND, fontSize: 14 },
  tinyHint: { fontSize: 12, color: SUBINK, marginTop: 6, fontStyle: 'italic' },

  rangeWrap: { alignItems: 'stretch', height: RB_RENDER_H, width: '100%' },

  rightNowLine: { fontSize: 15, color: INK },
  rightNowNumber: { fontWeight: '700' },
  rightNowDim: { color: SUBINK },
  rightNowDelta: { fontSize: 13, fontWeight: '600', marginTop: 6 },

  closureLine: { fontSize: 14, color: INK },
  closureFutureHint: { fontSize: 12, color: MUTED, marginTop: 6, fontStyle: 'italic' },
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
  bold: { fontWeight: '700' },

  notifHistoryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomColor: '#eef', // TODO: tokenize
    borderBottomWidth: 1,
  },
  notifHistoryIcon: { width: 18, marginRight: 8, marginTop: 1, alignItems: 'center' },
  notifHistoryText: { flex: 1, paddingRight: 8 },
  notifHistoryBody: { fontSize: 13, color: INK },
  notifHistoryWhen: { fontSize: 11, color: MUTED, marginTop: 2 },

  fallbackBlock: { flex: 1, justifyContent: 'center', padding: 32 },
  fallback: { fontSize: 14, color: SUBINK, textAlign: 'center' },
});
