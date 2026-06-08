import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { Ride, ScoreResult } from '../types';
import { formatBucketTimeSlot, formatHHMM } from '../timestamp';
import { colors } from '../theme/tokens';

interface DebugCardProps {
  ride: Ride;
  result: ScoreResult;
}

function pts(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
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

function FactorRow({ label, value, points, skipped }: {
  label: string;
  value: string;
  points: number;
  skipped?: boolean;
}) {
  const color = skipped ? '#aaa' /* TODO: tokenize */ : points > 0 ? '#1a7f37' /* TODO: tokenize */ : points < 0 ? colors.skip : '#666'; // TODO: tokenize
  return (
    <View style={styles.factorRow}>
      <Text style={styles.factorLabel}>{label}</Text>
      <Text style={[styles.factorValue, skipped && styles.skipped]}>{value}</Text>
      <Text style={[styles.factorPoints, { color }]}>{skipped ? '—' : pts(points)}</Text>
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

export function DebugCard({ ride, result }: DebugCardProps): React.ReactElement {
  const ha = ride.historicalAverage;
  const rs = ride.rideStats;
  const { factors, score, badge } = result;

  const nearTermValue = factors.nearTermChange !== null
    ? (() => {
        const pct = Math.round(factors.nearTermChange.delta * 100);
        const sign = pct > 0 ? '+' : '';
        return `${sign}${pct}% at t+30`;
      })()
    : 'no t+30 data';

  const projectedChangeValue = factors.projectedChange !== null
    ? (() => {
        const pct = Math.round(factors.projectedChange.delta * 100);
        const sign = pct > 0 ? '+' : '';
        const glyph = factors.projectedChange.delta > 0.001 ? '↗' : factors.projectedChange.delta < -0.001 ? '↘' : '→';
        return `${glyph} ${sign}${pct}% over 2hr`;
      })()
    : 'no projection';

  const avgWait = ha?.buckets[0].wait;
  const vsAvgValue = factors.vsAvg !== null
    ? `${avgWait ?? '?'} avg → ${ride.currentWait} now (${Math.round(factors.vsAvg.delta * 100) > 0 ? '+' : ''}${Math.round(factors.vsAvg.delta * 100)}%)`
    : 'bucket avg = 0';

  const vsRangeValue = factors.vsRange !== null
    ? (factors.vsRange.points >= 2 ? 'at/below min'
      : factors.vsRange.points === 1 ? 'near min'
      : factors.vsRange.points <= -2 ? 'at/above max'
      : factors.vsRange.points === -1 ? 'near max'
      : 'mid-range')
    : (rs === null ? 'no range data' : 'range < 5 min');

  const scoreSign = score > 0 ? '+' : '';
  const badgeLabel =
    badge === 'star' ? '★ STAR' :
    badge === 'go'   ? '✓ GO'   :
    badge === 'skip' ? '✕ SKIP' :
                       'no badge';
  const badgeColor =
    badge === 'star' ? '#d4af37' : // TODO: tokenize
    badge === 'go'   ? '#1a7f37' : // TODO: tokenize
    badge === 'skip' ? colors.skip :
                       colors.textTertiary;

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

      {/* Score factors */}
      <FactorRow
        label="vs avg"
        value={vsAvgValue}
        points={factors.vsAvg?.points ?? 0}
        skipped={factors.vsAvg === null}
      />
      <FactorRow
        label="range"
        value={vsRangeValue}
        points={factors.vsRange?.points ?? 0}
        skipped={factors.vsRange === null}
      />
      <FactorRow
        label="t+30"
        value={nearTermValue}
        points={factors.nearTermChange?.points ?? 0}
        skipped={factors.nearTermChange === null}
      />
      <FactorRow
        label="trend"
        value={projectedChangeValue}
        points={factors.projectedChange?.points ?? 0}
        skipped={factors.projectedChange === null}
      />

      <View style={styles.divider} />

      {/* Verdict */}
      <View style={styles.verdictRow}>
        <Text style={styles.verdictScore}>Score {scoreSign}{score}</Text>
        <Text style={[styles.verdictBadge, { color: badgeColor }]}>{badgeLabel}</Text>
      </View>

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
    width: 44,
  },
  factorValue: {
    flex: 1,
    fontSize: 11,
    color: '#444', // TODO: tokenize
  },
  factorPoints: {
    fontSize: 12,
    fontWeight: '700',
    width: 28,
    textAlign: 'right',
  },
  skipped: {
    color: '#bbb', // TODO: tokenize
  },

  // Verdict
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  verdictScore: {
    fontSize: 12,
    color: '#666', // TODO: tokenize
    fontWeight: '600',
  },
  verdictBadge: {
    fontSize: 14,
    fontWeight: '700',
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
