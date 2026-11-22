import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { num, pct } from '../format';
import { useChartTheme } from '../theme';
import type { ParkGrade, ReliabilityBin } from '../types';
import { Card, Empty } from './Card';
import { endLabel } from './chartLabels';
import { axisProps, tooltipProps } from './tooltip';

const CLASSES = ['rising', 'stable', 'falling'] as const;

/** Did the rising / stable / falling word users saw come true 30 minutes later? */
export function TrendScorecard({ trend }: { trend: ParkGrade['trend'] }) {
  const all = trend?.all;
  const sources = Object.keys(trend ?? {}).filter((k) => k !== 'all');
  return (
    <Card
      title={all ? `Trend word is right ${pct(all.accuracy)} of the time (always-"stable": ${pct(all.always_stable_accuracy)})` : 'Trend word'}
      sub="The arrow users see vs what the wait did by T+30 (±5 min = moved)"
    >
      {!all ? (
        <Empty>No trend calls have come due yet.</Empty>
      ) : (
        <>
          <p className="sub" style={{ margin: '0 0 8px' }}>
            {all.n} calls graded · {sources.map((s) => `${s} ${trend?.[s]?.n ?? 0}`).join(' · ')}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Word</th><th className="n">Precision</th><th className="n">Recall</th><th className="n">Actual n</th></tr>
              </thead>
              <tbody>
                {CLASSES.map((c) => (
                  <tr key={c}>
                    <td style={{ textTransform: 'capitalize' }}>{c}</td>
                    <td className="n">{pct(all.per_class[c]?.precision)}</td>
                    <td className="n">{pct(all.per_class[c]?.recall)}</td>
                    <td className="n">{num(all.per_class[c]?.support, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/** Reliability: does a 70% p_fall actually fall about 70% of the time? */
interface ReliabilityDotArgs { cx?: number; cy?: number; index?: number; payload?: ReliabilityBin }

export function ProbabilityHonesty({ honesty }: { honesty: ParkGrade['probability_honesty'] }) {
  const t = useChartTheme();
  const fall = honesty.p_fall_30 ?? [];
  const rise = honesty.p_rise_30 ?? [];
  const maxN = Math.max(1, ...fall.map((b) => b.n), ...rise.map((b) => b.n));
  // Dot area follows sample size; thin bins are also faint so they don't read as proof.
  const dotFor = (color: string) => ({ cx, cy, index, payload }: ReliabilityDotArgs) => (
    <circle key={index} cx={cx} cy={cy} r={3 + 5 * Math.sqrt((payload?.n ?? 0) / maxN)}
            fill={color} stroke={t.surface} strokeWidth={2} opacity={(payload?.n ?? 0) < 10 ? 0.4 : 1} />
  );
  const rows = [
    ...fall.map((b) => ({ field: 'Falls (p_fall_30)', ...b })),
    ...rise.map((b) => ({ field: 'Rises (p_rise_30)', ...b })),
  ];
  return (
    <Card
      title="Are the probabilities honest?"
      sub="Mean predicted probability vs how often it happened, by bin. On the diagonal = honest. Dot size = forecasts in the bin; faint = under 10."
      table={() => (
        <table>
          <thead><tr><th>Classifier</th><th className="n">n</th><th className="n">Predicted</th><th className="n">Happened</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}><td>{r.field}</td><td className="n">{r.n}</td><td className="n">{pct(r.mean_p)}</td><td className="n">{pct(r.observed)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    >
      {rows.length === 0 ? (
        <Empty>Needs at least 15 graded probabilities.</Empty>
      ) : (
        <>
          {/* Square, so "perfectly honest" is a true 45° diagonal. */}
          <div style={{ width: '100%', maxWidth: 380 }}>
            <ResponsiveContainer width="100%" aspect={1}>
              <LineChart margin={{ top: 6, right: 56, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={t.grid} />
                <XAxis dataKey="mean_p" type="number" domain={[0, 1]} tickFormatter={(v) => pct(v)} {...axisProps(t)} />
                <YAxis dataKey="observed" type="number" domain={[0, 1]} width={38} tickFormatter={(v) => pct(v)}
                       {...axisProps(t)} axisLine={false} />
                <Tooltip {...tooltipProps(t)} labelFormatter={(v) => `Predicted ${pct(v as number)}`}
                         formatter={(v, name, item) => [`${pct(v as number)} (n=${item.payload.n})`, `${name} happened`]} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={t.typical}
                               label={{ value: 'perfectly honest', fill: t.muted, fontSize: 11, position: 'insideBottomRight' }} />
                <Line data={fall} dataKey="observed" name="p_fall_30" stroke={t.actual} strokeWidth={2}
                      dot={dotFor(t.actual)} isAnimationActive={false}
                      label={endLabel('falls', t.actual, fall.length - 1)} />
                <Line data={rise} dataKey="observed" name="p_rise_30" stroke={t.inkSecondary} strokeWidth={2}
                      strokeDasharray="5 3" dot={dotFor(t.inkSecondary)} isAnimationActive={false}
                      label={endLabel('rises', t.inkSecondary, rise.length - 1)} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}
