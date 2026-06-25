// Ambient direction curve — communicates trend direction and approximate rate
// of change as a lightweight SVG bezier. Not a data visualization; makes no
// claims about specific future values.
//
// Structure:
//   Top row: direction label (left) + end time "3:30 PM" (right)
//   Below:   SVG curve, now-dot on left, projects rightward ~2 hours
//
// Fill baseline:
//   Rising / Stable → fill closes at y=75 (dot at y=50 → 25-unit band below it)
//   Dropping        → fill closes at y=100 (curve goes down to y=92; closing at
//                     y=75 would cross the curve and produce a weird polygon)

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../../theme/tokens';

type TrendDir = 'up' | 'down' | 'stable' | null;

interface Props {
  trendDir: TrendDir;
  bucket0Wait: number | null;
  bucket4Wait: number | null;
}

// ── Curve math ────────────────────────────────────────────────────────────────

// ViewBox 0 0 200 100 (2:1) matches the 2:1 container — no distortion.
// Dot is always at y=50 (center). Curve has 42 units of headroom in each
// direction (50 − VB_TOP=8, VB_BTM=92 − 50).
const VB_MID = 50;
const VB_TOP = 8;
const VB_BTM = 92;
const DOT_X  = 14;
const END_X  = 192;

function curveEndY(
  trendDir: TrendDir,
  bucket0Wait: number | null,
  bucket4Wait: number | null,
): number {
  if (!trendDir || trendDir === 'stable') return VB_MID;

  const delta = bucket0Wait != null && bucket4Wait != null
    ? Math.abs(bucket4Wait - bucket0Wait)
    : 10;

  const MIN = 0.3;
  const steepness = MIN + (1 - MIN) * Math.min(1, delta / 20);
  const range = trendDir === 'up' ? VB_MID - VB_TOP : VB_BTM - VB_MID;

  return Math.round(trendDir === 'up'
    ? VB_MID - range * steepness
    : VB_MID + range * steepness);
}

// ── Time label ────────────────────────────────────────────────────────────────

function roundedEndTime(): string {
  const THIRTY = 30 * 60_000;
  const rounded = Math.round((Date.now() + 120 * 60_000) / THIRTY) * THIRTY;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(rounded));
  const h      = parts.find(p => p.type === 'hour')?.value ?? '';
  const m      = parts.find(p => p.type === 'minute')?.value ?? '00';
  const period = parts.find(p => p.type === 'dayPeriod')?.value ?? '';
  return m === '00' ? `${h} ${period}` : `${h}:${m} ${period}`;
}

// ── Direction meta ─────────────────────────────────────────────────────────────

function dirMeta(trendDir: TrendDir): { label: string; color: string } {
  switch (trendDir) {
    case 'up':   return { label: 'Rising',   color: colors.trendUp };
    case 'down': return { label: 'Dropping', color: colors.trendDown };
    default:     return { label: 'Steady',   color: colors.trendFlat };
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DirectionCurve({ trendDir, bucket0Wait, bucket4Wait }: Props): React.ReactElement {
  const endY = useMemo(
    () => curveEndY(trendDir, bucket0Wait, bucket4Wait),
    [trendDir, bucket0Wait, bucket4Wait]
  );

  const endTime = useMemo(() => roundedEndTime(), []);
  const { label, color } = dirMeta(trendDir);

  const cp1 = `${DOT_X + 66} ${VB_MID}`;
  const cp2 = `${END_X - 52} ${endY}`;
  const curvePath = `M ${DOT_X} ${VB_MID} C ${cp1} ${cp2} ${END_X} ${endY}`;

  // For rising/stable the fill closes at y=75 — the dot sits at y=50 so this
  // gives a 25-unit fill band below it without touching VB_BTM (y=92).
  // For dropping the curve descends toward y=92, so we close at y=100 instead
  // to avoid the close line crossing the bezier path.
  const fillCloseY = trendDir === 'down' ? 100 : 75;
  const fillPath   = `${curvePath} L ${END_X} ${fillCloseY} L ${DOT_X} ${fillCloseY} Z`;
  const fillColor  = hexToRgba(color, 0.10);

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={[styles.dirLabel, { color }]}>{label}</Text>
        <Text style={styles.endTime}>{endTime}</Text>
      </View>

      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 200 100"
        preserveAspectRatio="none"
        style={{ flex: 1 }}
      >
        <Path d={fillPath} fill={fillColor} stroke="none" />
        <Path
          d={curvePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Circle
          cx={DOT_X}
          cy={VB_MID}
          r={3.5}
          fill="#fff"
          stroke={color}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  dirLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    flexShrink: 0,
  },
  endTime: {
    fontSize: 11,
    color: colors.textTertiary,
    flex: 1,
    textAlign: 'right',
  },
});
