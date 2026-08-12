import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { Ride } from '../types';
import { formatBucketTimeSlot, formatHHMM } from '../timestamp';
import { colors } from '../theme/tokens';

interface DebugCardProps {
  ride: Ride;
}

function BucketCol({
  label,
  wait,
  n,
  showN = true,
}: {
  label: string;
  wait: number | null;
  n?: number;
  showN?: boolean;
}) {
  return (
    <View style={styles.bucketCol}>
      <Text style={styles.bucketLabel}>{label}</Text>
      <Text style={styles.bucketWait}>{wait === null ? '—' : `${wait}`}</Text>
      {showN && n !== undefined && (
        <Text style={styles.bucketN}>n={n}</Text>
      )}
    </View>
  );
}

// Simple label / value row for the verdict-reason breakdown.
function KVRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.factorRow}>
      <Text style={styles.factorLabel}>{label}</Text>
      <Text style={[styles.factorValue, muted && styles.skipped]}>{value}</Text>
    </View>
  );
}

const SPARKLINE_HEIGHT = 40;
const SPARKLINE_PAD = 5;

function Sparkline({ values }: { values: (number | null)[] }) {
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  };

  const valid = values.filter((v): v is number => v !== null);
  const innerH = SPARKLINE_HEIGHT - SPARKLINE_PAD * 2;
  const step = width > 0 ? width / (values.length - 1) : 0;

  const minV = valid.length > 0 ? Math.min(...valid) : 0;
  const maxV = valid.length > 0 ? Math.max(...valid) : 1;
  const range = maxV - minV || 1;

  const toY = (v: number) =>
    SPARKLINE_PAD + innerH - ((v - minV) / range) * innerH;

  // Build contiguous polyline segments, skipping over null gaps
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length >= 2) segments.push(current.join(' '));
      current = [];
    } else {
      current.push(`${i * step},${toY(v)}`);
    }
  });
  if (current.length >= 2) segments.push(current.join(' '));

  const dots = values
    .map((v, i) => (v !== null ? { x: i * step, y: toY(v) } : null))
    .filter((d): d is { x: number; y: number } => d !== null);

  return (
    <View style={styles.sparklineContainer} onLayout={onLayout}>
      {width > 0 && valid.length >= 2 && (
        <Svg width={width} height={SPARKLINE_HEIGHT}>
          {segments.map((p, i) => (
            <Polyline
              key={i}
              points={p}
              fill="none"
              stroke="#6b6bf5" /* TODO: tokenize */
              strokeWidth={1.5}
            />
          ))}
          {dots.map((d, i) => (
            <Circle key={i} cx={d.x} cy={d.y} r={3} fill="#6b6bf5" /* TODO: tokenize */ />
          ))}
        </Svg>
      )}
    </View>
  );
}

const round = (n: number | null): string => (n == null ? '—' : `${Math.round(n)}`);

export function DebugCard({ ride }: DebugCardProps): React.ReactElement {
  const ha = ride.historicalAverage;
  const rs = ride.rideStats;

  // The two-layer verdict + its reasons — the same engine driving the badge,
  // the card "why" line, and the AI recs. This is the "why at a glance."
  const verdict = ride.verdict?.verdict ?? 'neutral';
  const r = ride.verdict?.reasons ?? null;

  const badgeLabel =
    verdict === 'star' ? '★ STAR' :
    verdict === 'go'   ? '✓ GO'   :
    verdict === 'skip' ? '✕ SKIP' :
                         '· NEUTRAL';
  const badgeColor =
    verdict === 'star' ? colors.star :
    verdict === 'go'   ? colors.go :
    verdict === 'skip' ? colors.skip :
                         colors.textTertiary;

  const windowValue = r?.betterWindowWait != null
    ? `${Math.round(r.betterWindowWait)} min${r.betterWindowInMin != null ? ` @ ${(r.betterWindowInMin / 60).toFixed(1)}h out` : ''}`
    : 'none reachable';

  // recentHistory is most-recent-first: [0]=t-20, [1]=t-40
  const tMinus20 = ride.recentHistory?.[0] ?? null;
  const tMinus40 = ride.recentHistory?.[1] ?? null;

  // Sparkline: t-40, t-20, now, +30, +60, +90, +120
  const sparkValues: (number | null)[] = [
    tMinus40?.wait ?? null,
    tMinus20?.wait ?? null,
    ride.currentWait,
    ha?.buckets[1].wait ?? null,
    ha?.buckets[2].wait ?? null,
    ha?.buckets[3].wait ?? null,
    ha?.buckets[4].wait ?? null,
  ];

  return (
    <View style={styles.card} testID={`debug-card-${ride.id}`}>

      {/* Verdict + primary reason — the headline "why" */}
      <View style={styles.verdictRow}>
        <Text style={[styles.verdictBadge, { color: badgeColor }]}>{badgeLabel}</Text>
        <Text style={styles.verdictReason}>{r ? r.primary : 'no verdict'}</Text>
      </View>

      <View style={styles.divider} />

      {/* 7-column bucket row: t-40 | t-20 | now | +30 | +60 | +90 | +120 */}
      <View style={styles.bucketsRow}>
        <BucketCol label={formatHHMM(tMinus40?.timestamp ?? null)} wait={tMinus40?.wait ?? null} showN={false} />
        <View style={styles.bucketDivider} />
        <BucketCol label={formatHHMM(tMinus20?.timestamp ?? null)} wait={tMinus20?.wait ?? null} showN={false} />
        <View style={styles.bucketDivider} />
        <BucketCol label="now" wait={ride.currentWait} showN={false} />
        <View style={styles.bucketDivider} />
        {ha ? (
          <>
            <BucketCol label={formatBucketTimeSlot(ha.buckets[1].timeSlot)} wait={ha.buckets[1].wait} n={ha.buckets[1].sampleCount} />
            <View style={styles.bucketDivider} />
            <BucketCol label={formatBucketTimeSlot(ha.buckets[2].timeSlot)} wait={ha.buckets[2].wait} n={ha.buckets[2].sampleCount} />
            <View style={styles.bucketDivider} />
            <BucketCol label={formatBucketTimeSlot(ha.buckets[3].timeSlot)} wait={ha.buckets[3].wait} n={ha.buckets[3].sampleCount} />
            <View style={styles.bucketDivider} />
            <BucketCol label={formatBucketTimeSlot(ha.buckets[4].timeSlot)} wait={ha.buckets[4].wait} n={ha.buckets[4].sampleCount} />
          </>
        ) : (
          <Text style={styles.noData}>No historical data</Text>
        )}
      </View>

      {/* Sparkline: t-40 → t+120 */}
      <Sparkline values={sparkValues} />

      <View style={styles.divider} />

      {/* Range */}
      <View style={styles.rangeRow}>
        <Text style={styles.rangeLabel}>Min</Text>
        <Text style={styles.rangeValue}>{rs ? `${rs.p10} min` : '—'}</Text>
        <View style={styles.rangeSpacer} />
        <Text style={styles.rangeLabel}>Max</Text>
        <Text style={styles.rangeValue}>{rs ? `${rs.p90} min` : '—'}</Text>
      </View>

      <View style={styles.divider} />

      {/* Verdict reason breakdown — the inputs that produced the verdict above */}
      <KVRow label="typical" value={r ? `${round(r.typical)} min for now` : '—'} muted={!r?.typical} />
      <KVRow label="today" value={r ? `p30 ${round(r.todayP30)} · p80 ${round(r.todayP80)}` : '—'} muted={r?.todayP30 == null} />
      <KVRow label="window" value={windowValue} muted={r?.betterWindowWait == null} />
      <KVRow label="beatable" value={r ? (r.beatableSoon ? 'yes — shorter window soon' : 'no') : '—'} />
      <KVRow label="rare" value={r ? (r.star ? 'yes — near its floor' : 'no') : '—'} muted={!r?.star} />

    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f4f4f7', // TODO: tokenize
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0', // TODO: tokenize
    gap: 8,
  },

  // Buckets
  bucketsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bucketCol: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  bucketDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#ddd', // TODO: tokenize
  },
  bucketLabel: {
    fontSize: 9,
    color: '#999', // TODO: tokenize
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bucketWait: {
    fontSize: 14,
    fontWeight: '700',
    color: '#222', // TODO: tokenize
  },
  bucketN: {
    fontSize: 9,
    color: '#aaa', // TODO: tokenize
  },

  // Sparkline
  sparklineContainer: {
    height: SPARKLINE_HEIGHT,
    marginHorizontal: -4,
  },

  // Range
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rangeLabel: {
    fontSize: 11,
    color: '#999', // TODO: tokenize
    marginRight: 4,
  },
  rangeValue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#444', // TODO: tokenize
  },
  rangeSpacer: {
    flex: 1,
  },

  // Factors
  factorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  factorLabel: {
    fontSize: 11,
    color: '#999', // TODO: tokenize
    width: 64,
  },
  factorValue: {
    flex: 1,
    fontSize: 11,
    color: '#444', // TODO: tokenize
  },
  skipped: {
    color: '#bbb', // TODO: tokenize
  },

  // Verdict
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  verdictBadge: {
    fontSize: 14,
    fontWeight: '700',
  },
  verdictReason: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  divider: {
    height: 1,
    backgroundColor: '#e0e0e0', // TODO: tokenize
  },

  noData: {
    fontSize: 11,
    color: '#aaa', // TODO: tokenize
    textAlign: 'center',
  },
});
