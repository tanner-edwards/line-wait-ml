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
import { AlertTriangle, Bell, CircleCheck, Footprints, OctagonX, Star, X } from 'lucide-react-native';
import { Sheet } from './Sheet';
import Svg, { Circle, Defs, Line, LinearGradient, Polygon, Polyline, Rect, Stop, Text as SvgText } from 'react-native-svg';
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
import { WalkPill } from './WalkPill';
import { TrendArrow } from './TrendArrow';
import { isWalkOnRide } from '../utils/walkOn';
import { trendDirection } from '../utils/trendDirection';
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
  const bucket4Wait = buckets?.[4]?.wait ?? null;
  const lowConfidence = (buckets?.[0]?.sampleCount ?? 0) < MIN_BUCKET_SAMPLE_COUNT;
  const bucket0SampleCount = buckets?.[0]?.sampleCount ?? 0;
  const isBelowNormal =
    isOperating && anchorWait !== null && bucket0Wait !== null &&
    bucket0Wait > 0 && bucket0SampleCount >= MIN_BUCKET_SAMPLE_COUNT &&
    anchorWait < bucket0Wait * 0.75;
  const isAboveNormal =
    isOperating && anchorWait !== null && bucket0Wait !== null &&
    bucket0Wait > 0 && bucket0SampleCount >= MIN_BUCKET_SAMPLE_COUNT &&
    anchorWait > bucket0Wait * 1.25;
  const waitColor = isBelowNormal ? colors.go : isAboveNormal ? colors.skip : INK;
  // Badge precedence: star > walkOn > go > skip.
  const showWalkOn = walkOn && badge !== 'star';

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
  const trendColor = trendDir === 'down' ? GREEN
    : trendDir === 'up' ? RED
    : colors.textTertiary;

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
      {/* ── Header block ───────────────────────────────────────────── */}
      <View style={styles.headerBlock}>

        {/* Row 1: ride name + close */}
        <View style={styles.nameCloseRow}>
          <Text style={styles.rideName}>{ride.name}</Text>
          <Pressable onPress={onDismissAll} hitSlop={12} testID="ride-detail-dismiss" style={styles.closeBtn}>
            <X size={18} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Row 2: badge pill — omitted when no signal */}
        {showWalkOn ? (
          <View style={styles.walkOnBadgeRow}>
            <Footprints size={14} color={colors.textSecondary} />
            <Text style={styles.walkOnBadgeLabel}>Walk On</Text>
          </View>
        ) : badge === 'star' ? (
          <View style={[styles.badgePill, { backgroundColor: colors.starBg }]}>
            <Star size={12} color={colors.star} fill={colors.star} />
            <Text style={[styles.badgePillText, { color: colors.star }]}>Rare find</Text>
          </View>
        ) : badge === 'go' ? (
          <View style={[styles.badgePill, { backgroundColor: colors.goBg }]}>
            <Text style={[styles.badgePillText, { color: colors.go }]}>Good time to ride</Text>
          </View>
        ) : badge === 'skip' ? (
          <View style={[styles.badgePill, { backgroundColor: colors.skipBg }]}>
            <Text style={[styles.badgePillText, { color: colors.skip }]}>Busier than usual</Text>
          </View>
        ) : null}

        {/* Row 3: location + wait number */}
        <View style={styles.locationWaitRow}>
          <Text style={styles.subtitle}>
            {ride.land}{parkName ? ` · ${parkName}` : ''}
          </Text>
          <View style={styles.waitRight}>
            {showWalkOn ? (
              <View style={styles.walkOnWaitRow}>
                <Footprints size={14} color={colors.textSecondary} />
                <Text style={styles.walkOnWaitText}>Walk On</Text>
              </View>
            ) : isDown ? (
              <View style={styles.waitStack}>
                <Text style={styles.closedLabel}>Closed</Text>
                {anchorWait !== null ? (
                  <Text style={styles.closedAnnotation}>{anchorWait} min at close</Text>
                ) : null}
              </View>
            ) : anchorWait !== null ? (
              <View style={styles.waitStack}>
                <View style={styles.waitNumberInline}>
                  <Text style={[styles.waitBig, { color: waitColor }]}>{anchorWait}</Text>
                  <Text style={styles.waitUnit}> min</Text>
                </View>
                {trendLabel ? (
                  <Text style={[styles.trendText, { color: trendColor }]}>{trendLabel}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* Row 4: walk time (left) + notify (right) */}
        <View style={styles.walkNotifyRow}>
          <View style={styles.walkTimeArea}>
            {walkMins != null ? <WalkPill minutes={walkMins} /> : null}
          </View>
          <Pressable
            onPress={onToggleWatch}
            style={[styles.notifyBtn, isWatching && styles.notifyBtnWatching]}
            hitSlop={8}
            testID={`detail-bell-${ride.id}`}
            accessibilityRole="button"
            accessibilityLabel={isWatching ? 'Remove alert' : 'Set alert'}
          >
            <Bell size={14} color={isWatching ? colors.star : colors.textInverse} />
            <Text style={[styles.notifyBtnText, isWatching && styles.notifyBtnWatchingText]}>
              {isWatching ? 'Watching' : 'Watch'}
            </Text>
          </Pressable>
        </View>

      </View>


      {/* Restriction note — only shown when the LLM flagged a persona conflict */}
      {restrictionNote ? (
        <View style={styles.restrictionBanner}>
          <AlertTriangle size={13} color={colors.star} style={styles.restrictionIcon} />
          <Text style={styles.restrictionText}>{restrictionNote}</Text>
        </View>
      ) : null}

      {/* AI one-liner — only present when opened from the recommendations page */}
      {oneLiner ? (
        <Tile>
          <Text style={styles.oneLiner}>{oneLiner}</Text>
        </Tile>
      ) : null}

      {/* Today's Range — merged range bar + typical marker + tagline */}
      {ride.rideStats ? (
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
            recentWait={ride.recentHistory?.[0]?.wait ?? null}
            bucket1Wait={buckets?.[1]?.wait ?? null}
            bucket3Wait={buckets?.[3]?.wait ?? null}
            bucket4Wait={bucket4Wait}
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
  recentWait,
  bucket1Wait,
  bucket3Wait,
  bucket4Wait,
}: {
  anchorWait: number | null;
  isDown: boolean;
  recentWait: number | null;
  bucket1Wait: number | null;
  bucket3Wait: number | null;
  bucket4Wait: number | null;
}): React.ReactElement | null {
  if (isDown) {
    return <Text style={styles.tinyHint}>Future grayed — we don't have a reopen estimate yet.</Text>;
  }
  // Same shared helper the label + arrow use, so caption can never disagree.
  const dir = trendDirection({
    currentWait: anchorWait,
    recentWait,
    bucket1Wait,
    bucket3Wait,
    bucket4Wait,
  });
  if (dir === null) return null;
  if (dir === 'stable') {
    return <Text style={styles.tinyHint}>Roughly flat over the next 2 hours.</Text>;
  }
  if (dir === 'up') {
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

// ---- Today's Range bar (merged range + typical + tagline) ----------

const TR_W = 360;
const TR_PAD_X = 12;
const HALF_BUBBLE = 22;          // half of bubble width (44 total)
const BUBBLE_TOP_Y = 4;
const BUBBLE_H = 18;
const BUBBLE_BOTTOM_Y = BUBBLE_TOP_Y + BUBBLE_H;     // 22
const POINTER_H = 7;
const POINTER_TIP_Y = BUBBLE_BOTTOM_Y + POINTER_H;   // 29
const TRACK_TOP_Y = POINTER_TIP_Y + 2;               // 31
const TRACK_H = 8;
const TRACK_CY = TRACK_TOP_Y + TRACK_H / 2;          // 35
const TRACK_BOTTOM_Y = TRACK_TOP_Y + TRACK_H;         // 39
const LABEL_Y = TRACK_BOTTOM_Y + 16;                  // 55
const TR_H = LABEL_Y + 10;                            // 65

function buildTagline(current: number | null, typical: number | null): string | null {
  if (current == null || typical == null) return null;
  const diff = Math.abs(Math.round(current - typical));
  if (diff <= 2) return 'Right around the usual wait for this time.';
  return current < typical
    ? `About ${diff} min less than usual right now.`
    : `About ${diff} min more than usual right now.`;
}

function TodaysRange({
  p10,
  p90,
  current,
  typicalWait,
}: {
  p10: number;
  p90: number;
  current: number | null;
  typicalWait: number | null;
}): React.ReactElement {
  const [renderW, setRenderW] = useState(0);

  const innerLeft = TR_PAD_X;
  const innerRight = TR_W - TR_PAD_X;
  const totalW = innerRight - innerLeft;
  const range = Math.max(1, p90 - p10);

  // Fill and dot use brand indigo — verdict lives in the header badge.
  const fillColor = '#4F46E5';

  // Current wait position (clamped to bar)
  const dotRatio = current != null
    ? Math.max(0, Math.min(1, (current - p10) / range))
    : null;
  const dotX = dotRatio != null ? innerLeft + dotRatio * totalW : null;

  // Bubble center — nudge away from edges so it doesn't clip
  const bubbleCx = dotX != null
    ? Math.max(innerLeft + HALF_BUBBLE, Math.min(innerRight - HALF_BUBBLE, dotX))
    : null;
  const bubbleLeft = bubbleCx != null ? bubbleCx - HALF_BUBBLE : null;

  // Typical marker — floats LEFT of track when typicalWait < p10 (below observed min).
  // When floating, we render it as a React Native element beside the SVG so we don't
  // need negative SVG x-coordinates. The visual gap between the marker and the track's
  // left edge communicates that current conditions are above the historical baseline.
  const typicalIsFloating = typicalWait != null && typicalWait < p10;
  const typicalRatio = !typicalIsFloating && typicalWait != null
    ? Math.max(0, Math.min(1, (typicalWait - p10) / range))
    : null;
  const typicalX = typicalRatio != null ? innerLeft + typicalRatio * totalW : null;
  const typicalLabelX = typicalX != null
    ? Math.max(innerLeft + 28, Math.min(innerRight - 28, typicalX))
    : null;

  // Nudge the p10 endpoint label right when the floating marker is present
  // so they don't overlap.
  const p10LabelX = typicalIsFloating ? innerLeft + 22 : innerLeft;

  const tagline = buildTagline(current, typicalWait);

  return (
    <View>
      {/* Bar row — floating typical marker sits to the left when needed */}
      <View style={styles.rangeBarRow}>
        {typicalIsFloating ? (
          <View style={styles.floatingTypical}>
            <View style={styles.floatingTypicalLine} />
            <Text style={styles.floatingTypicalLabel}>{`usually ${typicalWait}m`}</Text>
          </View>
        ) : null}
        <View
          style={{ flex: 1 }}
          onLayout={e => setRenderW(Math.round(e.nativeEvent.layout.width))}
        >
          {renderW > 0 ? (
            <Svg
              width={renderW}
              height={TR_H}
              viewBox={`0 0 ${TR_W} ${TR_H}`}
              preserveAspectRatio="none"
            >
              {/* Track background — plain neutral, no gradient */}
              <Rect
                x={innerLeft} y={TRACK_TOP_Y}
                width={totalW} height={TRACK_H}
                rx={TRACK_H / 2}
                fill={colors.border}
              />

              {/* Fill — from left edge to current position */}
              {dotX != null ? (
                <Rect
                  x={innerLeft} y={TRACK_TOP_Y}
                  width={Math.max(0, dotX - innerLeft)} height={TRACK_H}
                  rx={TRACK_H / 2}
                  fill={fillColor}
                />
              ) : null}

              {/* Typical marker — only when it falls within the track */}
              {typicalX != null ? (
                <Line
                  x1={typicalX} x2={typicalX}
                  y1={TRACK_TOP_Y - 4} y2={TRACK_BOTTOM_Y + 4}
                  stroke={MUTED} strokeWidth={2}
                />
              ) : null}

              {/* "usually Xm" label under typical marker */}
              {typicalX != null && typicalLabelX != null && typicalWait != null ? (
                <SvgText
                  x={typicalLabelX} y={LABEL_Y}
                  fontSize="10.5" fontWeight="500"
                  fill={SUBINK} textAnchor="middle"
                >
                  {`usually ${typicalWait}m`}
                </SvgText>
              ) : null}

              {/* Endpoint labels — min left, max right */}
              <SvgText x={p10LabelX} y={LABEL_Y} fontSize="10.5" fill={MUTED} textAnchor="start">{p10}m</SvgText>
              <SvgText x={innerRight} y={LABEL_Y} fontSize="10.5" fill={MUTED} textAnchor="end">{p90}m</SvgText>

              {/* Current wait dot */}
              {dotX != null ? (
                <Circle
                  cx={dotX} cy={TRACK_CY}
                  r={7} fill={fillColor}
                  stroke="white" strokeWidth={2}
                />
              ) : null}

              {/* Callout bubble above dot — pill shape */}
              {dotX != null && bubbleLeft != null && bubbleCx != null && current != null ? (
                <>
                  <Rect
                    x={bubbleLeft} y={BUBBLE_TOP_Y}
                    width={HALF_BUBBLE * 2} height={BUBBLE_H}
                    rx={BUBBLE_H / 2}
                    fill={fillColor}
                  />
                  <Polygon
                    points={`${bubbleCx - 5},${BUBBLE_BOTTOM_Y} ${bubbleCx + 5},${BUBBLE_BOTTOM_Y} ${dotX},${POINTER_TIP_Y}`}
                    fill={fillColor}
                  />
                  <SvgText
                    x={bubbleCx} y={BUBBLE_TOP_Y + BUBBLE_H - 5}
                    fontSize="11" fontWeight="700"
                    fill="white" textAnchor="middle"
                  >
                    {`${current}m`}
                  </SvgText>
                </>
              ) : null}
            </Svg>
          ) : null}
        </View>
      </View>

      {/* Tagline below bar */}
      {tagline ? (
        <>
          <View style={styles.taglineDivider} />
          <Text style={styles.tagline}>{tagline}</Text>
        </>
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
  // ── Header styles ─────────────────────────────────────────────────
  nameCloseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rideName: {
    fontFamily: 'Lora_600SemiBold',
    fontSize: 20,
    fontWeight: '600',
    color: INK,
    lineHeight: 26,
    flex: 1,
    marginRight: 12,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  walkOnBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  walkOnBadgeLabel: { fontSize: 13, color: SUBINK },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    marginBottom: 6,
  },
  badgePillText: { fontSize: 12, fontWeight: '600' },
  locationWaitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  subtitle: { fontSize: 13, color: SUBINK, flex: 1, marginRight: 12, marginTop: 2 },
  waitRight: { alignItems: 'flex-end', flexShrink: 0 },
  waitNumberInline: { flexDirection: 'row', alignItems: 'baseline' },
  waitBig: {
    fontSize: 36,
    fontWeight: '700',
    fontFamily: 'Outfit_700Bold',
    color: INK,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.72,
    lineHeight: 36,
  },
  waitUnit: { fontSize: 12, color: SUBINK, marginLeft: 2 },
  walkOnWaitRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  walkOnWaitText: { fontSize: 13, color: SUBINK },
  waitStack: { alignItems: 'flex-end', gap: 2 },
  closedLabel: { fontSize: 15, fontWeight: '600', color: MUTED },
  closedAnnotation: { fontSize: 11, color: MUTED, textAlign: 'right' },
  trendText: { fontSize: 12.5, fontWeight: '600' },
  walkNotifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  walkTimeArea: { flexDirection: 'row', alignItems: 'center' },
  notifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: BRAND,
  },
  notifyBtnWatching: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  notifyBtnText: { fontSize: 13, fontWeight: '600', color: colors.textInverse },
  notifyBtnWatchingText: { color: colors.textSecondary, fontWeight: '500' },

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
  oneLiner: { fontSize: 14, color: SUBINK, lineHeight: 20 },

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

  rangeBarRow: { flexDirection: 'row', alignItems: 'flex-start' },
  floatingTypical: {
    width: 44,
    paddingTop: TRACK_TOP_Y - 4, // align with track
    alignItems: 'center',
  },
  floatingTypicalLine: {
    width: 2,
    height: TRACK_H + 8,
    backgroundColor: MUTED,
    borderRadius: 2,
  },
  floatingTypicalLabel: {
    fontSize: 10.5,
    fontWeight: '500',
    color: SUBINK,
    marginTop: 4,
    textAlign: 'center',
  },
  taglineDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#eef',
    marginTop: 10,
    marginBottom: 8,
  },
  tagline: { fontSize: 13, color: SUBINK, fontStyle: 'italic' },

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
  restrictionText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
});
