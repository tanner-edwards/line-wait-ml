import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ride, ScoreResult } from '../types';
import { formatBucketTimeSlot } from '../timestamp';

interface DebugCardProps {
  ride: Ride;
  result: ScoreResult;
}

function pts(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function BucketCol({ label, wait, n }: { label: string; wait: number | null; n: number }) {
  return (
    <View style={styles.bucketCol}>
      <Text style={styles.bucketLabel}>{label}</Text>
      <Text style={styles.bucketWait}>{wait === null ? '—' : `${wait}`}</Text>
      <Text style={styles.bucketN}>n={n}</Text>
    </View>
  );
}

function FactorRow({ label, value, points, skipped }: {
  label: string;
  value: string;
  points: number;
  skipped?: boolean;
}) {
  const color = skipped ? '#aaa' : points > 0 ? '#1a7f37' : points < 0 ? '#c41e3a' : '#666';
  return (
    <View style={styles.factorRow}>
      <Text style={styles.factorLabel}>{label}</Text>
      <Text style={[styles.factorValue, skipped && styles.skipped]}>{value}</Text>
      <Text style={[styles.factorPoints, { color }]}>{skipped ? '—' : pts(points)}</Text>
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
    badge === 'star' ? '#d4af37' :
    badge === 'go'   ? '#1a7f37' :
    badge === 'skip' ? '#c41e3a' :
                       '#888';

  return (
    <View style={styles.card} testID={`debug-card-${ride.id}`}>

      {/* Bucket columns */}
      {ha ? (
        <View style={styles.bucketsRow}>
          <BucketCol label={formatBucketTimeSlot(ha.buckets[1].timeSlot)} wait={ha.buckets[1].wait} n={ha.buckets[1].sampleCount} />
          <View style={styles.bucketDivider} />
          <BucketCol label={formatBucketTimeSlot(ha.buckets[2].timeSlot)} wait={ha.buckets[2].wait} n={ha.buckets[2].sampleCount} />
          <View style={styles.bucketDivider} />
          <BucketCol label={formatBucketTimeSlot(ha.buckets[3].timeSlot)} wait={ha.buckets[3].wait} n={ha.buckets[3].sampleCount} />
          <View style={styles.bucketDivider} />
          <BucketCol label={formatBucketTimeSlot(ha.buckets[4].timeSlot)} wait={ha.buckets[4].wait} n={ha.buckets[4].sampleCount} />
        </View>
      ) : (
        <Text style={styles.noData}>No historical data</Text>
      )}

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
    backgroundColor: '#f4f4f7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
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
    backgroundColor: '#ddd',
  },
  bucketLabel: {
    fontSize: 10,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bucketWait: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
  },
  bucketN: {
    fontSize: 10,
    color: '#aaa',
  },

  // Range
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rangeLabel: {
    fontSize: 11,
    color: '#999',
    marginRight: 4,
  },
  rangeValue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#444',
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
    color: '#999',
    width: 44,
  },
  factorValue: {
    flex: 1,
    fontSize: 11,
    color: '#444',
  },
  factorPoints: {
    fontSize: 12,
    fontWeight: '700',
    width: 28,
    textAlign: 'right',
  },
  skipped: {
    color: '#bbb',
  },

  // Verdict
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  verdictScore: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  verdictBadge: {
    fontSize: 14,
    fontWeight: '700',
  },

  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
  },

  noData: {
    fontSize: 11,
    color: '#aaa',
    textAlign: 'center',
  },
});
