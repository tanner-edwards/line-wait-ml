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

import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { useRides } from '../context/RideContext';
import { useLocation } from '../context/LocationContext';
import { haversineMeters } from '../grouping';
import { formatHHMM, formatTimeAgo } from '../timestamp';
import { RecommendationBadge } from './RecommendationBadge';
import { isWalkOnRide } from '../utils/walkOn';
import { isParkError, Ride } from '../types';

const BRAND = '#4a4ec7';
const BRAND_DIM = '#a3a5e4';
const MUTED = '#bbb';
const GREEN = '#2a8f3e';
const RED = '#c41e3a';
const INK = '#222';
const SUBINK = '#666';

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

export function NotificationDetailModal(): React.ReactElement {
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
  const visible = active !== null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeDetail}>
      <SafeAreaView style={styles.container}>
        <View style={styles.headerBar}>
          <Pressable
            onPress={closeDetail}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            testID="ride-detail-back"
            hitSlop={12}
          >
            <Text style={styles.backArrow}>‹ Back</Text>
          </Pressable>
          <Pressable
            onPress={dismissAll}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            testID="ride-detail-dismiss"
            hitSlop={12}
          >
            <Text style={styles.dismissX}>✕</Text>
          </Pressable>
        </View>
        {ride ? (
          <DetailBody ride={ride} parkName={parkName} userCoords={coords} />
        ) : active ? (
          <View style={styles.fallbackBlock}>
            <Text style={styles.fallback}>
              That ride isn't in the current snapshot. Check the Browse tab for the latest status.
            </Text>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function DetailBody({
  ride,
  parkName,
  userCoords,
}: {
  ride: Ride;
  parkName: string | null;
  userCoords: { lat: number; lng: number } | null;
}): React.ReactElement {
  const isOperating = ride.status === 'OPERATING';
  const isDown = ride.status === 'DOWN';
  const walkOn = isOperating && isWalkOnRide(ride.id, ride.currentWait);
  const badge = ride.score?.badge ?? null;

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

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {/* Title block */}
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{ride.name}</Text>
        <Text style={styles.subtitle}>
          {ride.land}{parkName ? ` · ${parkName}` : ''}
        </Text>
      </View>

      {/* Status row — wait/closed + badge + below-normal pill */}
      <StatusRow
        isOperating={isOperating}
        isDown={isDown}
        statusText={ride.status}
        wait={anchorWait}
        closedAnnotation={isDown && closedWait != null}
        badge={badge}
        walkOn={walkOn}
        aboveBelow={aboveBelow}
      />

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
            closedAt={ride.closedAt ?? null}
          />
          <TrendCaption
            anchorWait={anchorWait}
            isDown={isDown}
            futureBuckets={buckets ?? null}
          />
        </Tile>
      ) : null}

      {/* Range band — p10 ... p90 */}
      {ride.rideStats ? (
        <Tile>
          <TileLabel>Typical range (p10 – p90)</TileLabel>
          <RangeBand
            p10={ride.rideStats.p10}
            p90={ride.rideStats.p90}
            current={anchorWait}
            isDown={isDown}
          />
        </Tile>
      ) : null}

      {/* Closure tile */}
      {isDown ? (
        <Tile>
          <TileLabel>Closure</TileLabel>
          {ride.closedAt ? (
            <Text style={styles.closureLine}>
              Closed at <Text style={styles.bold}>{formatHHMM(ride.closedAt)}</Text>
              {' '}({formatTimeAgo(ride.closedAt)})
            </Text>
          ) : (
            <Text style={styles.closureLine}>Currently down.</Text>
          )}
          <Text style={styles.closureFutureHint}>
            Reopen estimate — coming soon.
          </Text>
        </Tile>
      ) : null}

      {/* Walk distance */}
      {walkMins != null ? (
        <Tile>
          <TileLabel>From here</TileLabel>
          <Text style={styles.tileBody}>
            ~{walkMins} min walk from your current location.
          </Text>
        </Tile>
      ) : null}
    </ScrollView>
  );
}

// ---- Status row ---------------------------------------------------

function StatusRow({
  isOperating,
  isDown,
  statusText,
  wait,
  closedAnnotation,
  badge,
  walkOn,
  aboveBelow,
}: {
  isOperating: boolean;
  isDown: boolean;
  statusText: string;
  wait: number | null;
  closedAnnotation: boolean;
  badge: 'star' | 'go' | 'skip' | null;
  walkOn: boolean;
  aboveBelow: AboveBelow | null;
}): React.ReactElement {
  return (
    <View style={styles.statusRow}>
      <View style={styles.statusWaitBlock}>
        {isOperating && wait != null ? (
          <Text style={styles.statusWait}>
            {wait}<Text style={styles.statusWaitUnit}> min</Text>
          </Text>
        ) : isDown && wait != null ? (
          <View>
            <Text style={styles.statusWait}>
              {wait}<Text style={styles.statusWaitUnit}> min</Text>
            </Text>
            <Text style={styles.statusWaitAnnotation}>at time of close</Text>
          </View>
        ) : (
          <Text style={[styles.statusPill, isDown ? styles.statusPillClosed : styles.statusPillOther]}>
            {isDown ? 'Closed' : statusText}
          </Text>
        )}
      </View>
      <View style={styles.statusBadges}>
        {walkOn ? (
          <Text style={styles.walkOnEmoji}>🚶</Text>
        ) : badge ? (
          <RecommendationBadge badge={badge} />
        ) : null}
        {aboveBelow ? (
          <View style={[styles.belowAbovePill, { backgroundColor: aboveBelow.pillBg }]}>
            <Text style={[styles.belowAbovePillText, { color: aboveBelow.color }]}>
              {aboveBelow.shortLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ---- Trend graph (SVG) --------------------------------------------

// Trend graph dimensions — tall enough to give the Y axis room to breathe.
// Width is "100%" via the SVG attribute; the internal viewBox is just the
// coordinate system. Height is fixed in pixels so the graph occupies a
// real, readable chunk of the screen.
const GRAPH_W = 360;
const GRAPH_H = 280;
const GRAPH_RENDER_H = 280;
const G_PAD_LEFT = 40;   // room for Y axis labels (3 digits + tick)
const G_PAD_RIGHT = 16;
const G_PAD_TOP = 28;
const G_PAD_BOTTOM = 32;

function TrendGraph({
  recentHistory,
  anchorWait,
  isDown,
  buckets,
  closedAt,
}: {
  recentHistory: { timestamp: string; minutesAgo: number; wait: number | null; status: string }[];
  anchorWait: number | null;
  isDown: boolean;
  buckets: { offsetMinutes: number; timeSlot: string; wait: number | null; sampleCount: number }[] | null;
  closedAt: string | null;
}): React.ReactElement {
  // X axis: past 30 min on the left, +2 hours on the right, "now" at x = 0.
  const xMin = -30;
  const xMax = 120;
  const plotW = GRAPH_W - G_PAD_LEFT - G_PAD_RIGHT;
  const plotH = GRAPH_H - G_PAD_TOP - G_PAD_BOTTOM;
  const xToPx = (xMin_: number) => G_PAD_LEFT + ((xMin_ - xMin) / (xMax - xMin)) * plotW;

  // Past points: recentHistory + anchor (if operating). For DOWN rides,
  // the anchor IS the wait at time of close so it still belongs on the
  // past line. Use h.timestamp (wall-clock-accurate) not minutesAgo
  // (stale at API response time) so dots land on the correct x tick.
  const renderNow = Date.now();
  const pastPoints: { x: number; y: number | null }[] = [];
  for (const h of recentHistory) {
    const x = -(renderNow - new Date(h.timestamp).getTime()) / 60_000;
    if (x < xMin) continue;
    pastPoints.push({ x, y: h.status === 'OPERATING' && h.wait != null ? h.wait : null });
  }
  pastPoints.sort((a, b) => a.x - b.x);
  // The "now" point is anchorWait, plotted at x=0 for operating rides
  // and at the closedAt offset for closed rides.
  let nowX = 0;
  if (isDown && closedAt) {
    const minutesSinceClose = Math.round((Date.now() - new Date(closedAt).getTime()) / 60_000);
    // closedAt sits in the past, so x is negative.
    nowX = -minutesSinceClose;
  }
  if (anchorWait != null) {
    pastPoints.push({ x: nowX, y: anchorWait });
  }

  // Future points: historical buckets, anchored to "now" via anchorWait
  // if we have one (smooth transition). For DOWN rides we still draw
  // the future curve, just grayed out.
  const futurePoints: { x: number; y: number | null }[] = [];
  if (anchorWait != null && !isDown) {
    futurePoints.push({ x: 0, y: anchorWait });
  }
  if (buckets) {
    for (const b of buckets) {
      if (b.offsetMinutes === 0) continue;
      futurePoints.push({ x: b.offsetMinutes, y: b.wait });
    }
  }

  // Y scale: pick a range that comfortably fits everything we'll plot.
  const allWaits: number[] = [];
  for (const p of pastPoints) if (p.y != null) allWaits.push(p.y);
  for (const p of futurePoints) if (p.y != null) allWaits.push(p.y);
  const yMax = Math.max(20, ...allWaits) * 1.15;
  const yMin = 0;
  const yToPx = (y: number) => G_PAD_TOP + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  // Build polyline strings. Drop null points so the lines skip gaps.
  const pastPath = pastPoints
    .filter(p => p.y != null)
    .map(p => `${xToPx(p.x)},${yToPx(p.y!)}`)
    .join(' ');
  const futurePath = futurePoints
    .filter(p => p.y != null)
    .map(p => `${xToPx(p.x)},${yToPx(p.y!)}`)
    .join(' ');

  // X axis ticks — California actual times so the guest can cross-reference
  // the graph against their schedule without mental math.
  const ptTimeLabel = (offsetMinutes: number) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(renderNow + offsetMinutes * 60_000));
  const xTicks: { x: number; label: string }[] = [
    { x: -30, label: ptTimeLabel(-30) },
    { x: 0,   label: ptTimeLabel(0) },
    { x: 30,  label: ptTimeLabel(30) },
    { x: 60,  label: ptTimeLabel(60) },
    { x: 90,  label: ptTimeLabel(90) },
    { x: 120, label: ptTimeLabel(120) },
  ];

  // Y axis ticks — pick a "nice" step (5/10/15/20/25/50…) so we get
  // roughly 4–6 evenly-spaced labels covering the data range.
  const yTickStep = niceTickStep(yMax);
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += yTickStep) yTicks.push(v);

  const nowPx = xToPx(nowX);

  // Measure the container width via onLayout — react-native-svg's
  // width="100%" doesn't always expand correctly on Expo Web, which is
  // what was making the graph look ~50% of screen width. Once we have
  // a real pixel width we pass it to the Svg and let preserveAspectRatio
  // stretch the viewBox to match.
  const [renderW, setRenderW] = useState(0);
  return (
    <View
      style={styles.graphWrap}
      onLayout={e => setRenderW(Math.round(e.nativeEvent.layout.width))}
    >
      {renderW > 0 ? (
      <Svg
        width={renderW}
        height={GRAPH_RENDER_H}
        viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
        preserveAspectRatio="none"
      >
        {/* Horizontal gridlines + Y-axis tick labels */}
        {yTicks.map(v => (
          <React.Fragment key={`y-${v}`}>
            <Line
              x1={G_PAD_LEFT} x2={GRAPH_W - G_PAD_RIGHT}
              y1={yToPx(v)} y2={yToPx(v)}
              stroke="#f0f0f5" strokeWidth={1}
            />
            <SvgText
              x={G_PAD_LEFT - 6}
              y={yToPx(v) + 3}
              fontSize="10"
              fill={SUBINK}
              textAnchor="end"
            >
              {v}
            </SvgText>
          </React.Fragment>
        ))}

        {/* Y axis line itself */}
        <Line
          x1={G_PAD_LEFT} x2={G_PAD_LEFT}
          y1={G_PAD_TOP - 4} y2={GRAPH_H - G_PAD_BOTTOM}
          stroke="#ddd" strokeWidth={1}
        />

        {/* Baseline (X axis) */}
        <Line
          x1={G_PAD_LEFT} x2={GRAPH_W - G_PAD_RIGHT}
          y1={GRAPH_H - G_PAD_BOTTOM} y2={GRAPH_H - G_PAD_BOTTOM}
          stroke="#ddd" strokeWidth={1}
        />

        {/* "Now" vertical marker */}
        <Line
          x1={nowPx} x2={nowPx}
          y1={G_PAD_TOP - 4} y2={GRAPH_H - G_PAD_BOTTOM + 4}
          stroke={MUTED} strokeWidth={1} strokeDasharray="2,3"
        />

        {/* Past line (solid) */}
        {pastPath.split(' ').length >= 2 ? (
          <Polyline
            points={pastPath}
            fill="none"
            stroke={BRAND}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {/* Future line (dashed). Grayed when ride is down — we don't
            know when it'll reopen. */}
        {futurePath.split(' ').length >= 2 ? (
          <Polyline
            points={futurePath}
            fill="none"
            stroke={isDown ? MUTED : BRAND_DIM}
            strokeWidth={2}
            strokeDasharray="4,4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {/* Past data points (small dots) */}
        {pastPoints
          .filter(p => p.y != null)
          .map((p, i) => (
            <Circle
              key={`past-${i}`}
              cx={xToPx(p.x)} cy={yToPx(p.y!)}
              r={2.5}
              fill={BRAND}
            />
          ))}

        {/* "Now" dot — bigger */}
        {anchorWait != null ? (
          <>
            <Circle
              cx={nowPx} cy={yToPx(anchorWait)}
              r={6}
              fill="#fff"
              stroke={isDown ? RED : BRAND}
              strokeWidth={2.5}
            />
            <SvgText
              x={nowPx}
              y={yToPx(anchorWait) - 11}
              fontSize="11"
              fontWeight="700"
              fill={INK}
              textAnchor="middle"
            >
              {anchorWait}
            </SvgText>
          </>
        ) : null}

        {/* X-axis tick labels */}
        {xTicks.map(t => (
          <SvgText
            key={t.label}
            x={xToPx(t.x)}
            y={GRAPH_H - 8}
            fontSize="10"
            fill={SUBINK}
            textAnchor="middle"
          >
            {t.label}
          </SvgText>
        ))}
      </Svg>
      ) : null}
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
const RB_H = 200;
const RB_RENDER_H = 200;
// Side padding kept small so the bar genuinely spans the screen in the
// happy path. End-cap labels are anchored at bandStart/bandEnd so they
// follow the bar position even when it shifts for an out-of-band dot.
const RB_PAD_X = 16;
const RB_BAR_Y = 88;

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
  let dotColor = isDown ? RED : BRAND;
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
            stroke={extension.color} strokeWidth={3} strokeDasharray="6,5"
            strokeLinecap="round"
          />
        ) : null}

        {/* The bar itself — left cap, connector, right cap. No fill. */}
        <Line
          x1={bandStart} x2={bandStart}
          y1={bandY - 16} y2={bandY + 16}
          stroke={BRAND} strokeWidth={3}
          strokeLinecap="round"
        />
        <Line
          x1={bandEnd} x2={bandEnd}
          y1={bandY - 16} y2={bandY + 16}
          stroke={BRAND} strokeWidth={3}
          strokeLinecap="round"
        />
        <Line
          x1={bandStart} x2={bandEnd}
          y1={bandY} y2={bandY}
          stroke={BRAND} strokeWidth={3}
          strokeLinecap="round"
        />

        {/* p10 / p90 labels — sit under the relevant end-cap */}
        <SvgText x={bandStart} y={bandY + 38} fontSize="20" fontWeight="700" fill={INK} textAnchor="middle">{p10}</SvgText>
        <SvgText x={bandEnd}   y={bandY + 38} fontSize="20" fontWeight="700" fill={INK} textAnchor="middle">{p90}</SvgText>
        <SvgText x={bandStart} y={bandY + 58} fontSize="12" fill={MUTED} textAnchor="middle">p10</SvgText>
        <SvgText x={bandEnd}   y={bandY + 58} fontSize="12" fill={MUTED} textAnchor="middle">p90</SvgText>

        {/* Current-wait dot + value label above */}
        {dotX != null && current != null ? (
          <>
            <Circle
              cx={dotX} cy={bandY}
              r={14}
              fill="#fff"
              stroke={dotColor}
              strokeWidth={3.5}
            />
            <SvgText
              x={dotX}
              y={bandY - 26}
              fontSize="22"
              fontWeight="700"
              fill={INK}
              textAnchor="middle"
            >
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
    return { percent, arrow: '→', color: SUBINK, pillBg: '#f4f4f4', shortLabel: 'Typical' };
  }
  if (percent < 0) {
    return { percent, arrow: '↘', color: GREEN, pillBg: '#e6f7e9', shortLabel: 'Below typical' };
  }
  return { percent, arrow: '↗', color: RED, pillBg: '#fde2e2', shortLabel: 'Above typical' };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
  },
  backButton: { paddingHorizontal: 12, paddingVertical: 6 },
  backButtonPressed: { opacity: 0.5 },
  backArrow: { fontSize: 16, color: BRAND, fontWeight: '600' },
  dismissX: { fontSize: 16, color: MUTED, fontWeight: '600' },

  body: { padding: 10, paddingBottom: 48 },

  titleBlock: { marginBottom: 12, paddingHorizontal: 4 },
  title: { fontSize: 22, fontWeight: '700', color: INK },
  subtitle: { fontSize: 13, color: SUBINK, marginTop: 4 },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  statusWaitBlock: { flexShrink: 1 },
  statusWait: { fontSize: 36, fontWeight: '700', color: INK },
  statusWaitUnit: { fontSize: 16, fontWeight: '500', color: SUBINK },
  statusWaitAnnotation: { fontSize: 11, color: RED, marginTop: -4 },
  statusPill: {
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  statusPillClosed: { backgroundColor: '#fde2e2', color: RED },
  statusPillOther: { backgroundColor: '#f4f4f4', color: SUBINK },
  statusBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  walkOnEmoji: { fontSize: 22 },
  belowAbovePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  belowAbovePillText: { fontSize: 11, fontWeight: '700' },

  tile: {
    backgroundColor: '#fafaff',
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
    borderColor: '#eef',
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
  tinyHint: { fontSize: 12, color: SUBINK, marginTop: 6, fontStyle: 'italic' },

  rangeWrap: { alignItems: 'stretch', minHeight: RB_RENDER_H, width: '100%' },

  rightNowLine: { fontSize: 15, color: INK },
  rightNowNumber: { fontWeight: '700' },
  rightNowDim: { color: SUBINK },
  rightNowDelta: { fontSize: 13, fontWeight: '600', marginTop: 6 },

  closureLine: { fontSize: 14, color: INK },
  closureFutureHint: { fontSize: 12, color: MUTED, marginTop: 6, fontStyle: 'italic' },
  bold: { fontWeight: '700' },

  fallbackBlock: { flex: 1, justifyContent: 'center', padding: 32 },
  fallback: { fontSize: 14, color: SUBINK, textAlign: 'center' },
});
