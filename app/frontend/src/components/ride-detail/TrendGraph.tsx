// 7-column sparkline: t-40, t-20, now, +30, +60, +90, +120.
//
// Header above the SVG shows time labels + wait values for each column;
// the SVG itself draws a polyline through the actuals (past, solid) and
// the historical-average future (dashed). Dots align with column centers
// so the labels and points read together as a single chart.
//
// When the next 30-min bucket is imminent (≤5 min away), shift the future
// indices forward by one — the backend supplies a 6th t+150 bucket exactly
// to keep a full 2-hour lookahead in that case.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { colors } from '../../theme/tokens';
import { formatBucketTimeSlot, formatHHMM } from '../../timestamp';

const BRAND = colors.brand;
const BRAND_DIM = '#a3a5e4'; // TODO: tokenize
const MUTED = '#bbb'; // TODO: tokenize
const INK = '#222'; // TODO: tokenize
const SUBINK = '#666'; // TODO: tokenize
const RED = colors.skip;

const GRAPH_RENDER_H = 90;
const COLUMN_COUNT = 7;

interface Props {
  recentHistory: { timestamp: string; minutesAgo: number; wait: number | null; status: string }[];
  anchorWait: number | null;
  isDown: boolean;
  buckets: { offsetMinutes: number; timeSlot: string; wait: number | null; sampleCount: number }[] | null;
}

export function TrendGraph({
  recentHistory,
  anchorWait,
  isDown,
  buckets,
}: Props): React.ReactElement {
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

  // Measure rendered width — react-native-svg's width="100%" doesn't always
  // expand on Expo Web. Pass a real pixel value.
  const [renderW, setRenderW] = useState(0);
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
  // We always transition past→future at nowIdx so future dots get dashed.
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

const styles = StyleSheet.create({
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
});
