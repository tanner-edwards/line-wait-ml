import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { num, pct } from '../format';
import { useChartTheme } from '../theme';
import type { ParkGrade } from '../types';
import { Card, Empty, Legend } from './Card';
import { axisProps, tooltipProps } from './tooltip';

const CLASSES = ['rising', 'stable', 'falling'] as const;

/** Did the rising / stable / falling word users saw come true 30 minutes later? */
export function TrendScorecard({ trend }: { trend: ParkGrade['trend'] }) {
  const all = trend?.all;
  const sources = Object.keys(trend ?? {}).filter((k) => k !== 'all');
  return (
    <Card title="Trend word" sub="The arrow users see vs what the wait did by T+30 (±5 min = moved)">
      {!all ? (
        <Empty>No trend calls have come due yet.</Empty>
      ) : (
        <>
          <div className="tiles" style={{ marginTop: 0, marginBottom: 12 }}>
            <div className="tile">
              <div className="label">Called right</div>
              <div className="value">{pct(all.accuracy)}</div>
              <div className={`delta ${(all.accuracy ?? 0) >= (all.always_stable_accuracy ?? 0) ? 'good' : 'bad'}`}>
                always-"stable" {pct(all.always_stable_accuracy)}
              </div>
            </div>
            <div className="tile">
              <div className="label">Calls graded</div>
              <div className="value">{all.n}</div>
              <div className="delta" style={{ color: 'var(--text-2)' }}>
                {sources.map((s) => `${s} ${trend?.[s]?.n ?? 0}`).join(' · ')}
              </div>
            </div>
          </div>
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
export function ProbabilityHonesty({ honesty }: { honesty: ParkGrade['probability_honesty'] }) {
  const t = useChartTheme();
  const fall = honesty.p_fall_30 ?? [];
  const rise = honesty.p_rise_30 ?? [];
  const rows = [
    ...fall.map((b) => ({ field: 'Falls (p_fall_30)', ...b })),
    ...rise.map((b) => ({ field: 'Rises (p_rise_30)', ...b })),
  ];
  return (
    <Card
      title="Are the probabilities honest?"
      sub="Mean predicted probability vs how often it happened, by bin. On the diagonal = honest."
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
          <Legend items={[
            { label: 'p_fall_30', color: t.forecast },
            { label: 'p_rise_30', color: t.persistence },
            { label: 'Perfectly honest', color: t.typical, kind: 'ref' },
          ]} />
          <div className="chart">
            <ResponsiveContainer>
              <LineChart margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={t.grid} />
                <XAxis dataKey="mean_p" type="number" domain={[0, 1]} tickFormatter={(v) => pct(v)} {...axisProps(t)} />
                <YAxis dataKey="observed" type="number" domain={[0, 1]} width={38} tickFormatter={(v) => pct(v)}
                       {...axisProps(t)} axisLine={false} />
                <Tooltip {...tooltipProps(t)} labelFormatter={(v) => `Predicted ${pct(v as number)}`}
                         formatter={(v, name) => [pct(v as number), `${name} happened`]} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={t.typical} />
                <Line data={fall} dataKey="observed" name="p_fall_30" stroke={t.forecast} strokeWidth={2}
                      dot={{ r: 4, fill: t.forecast, stroke: t.surface, strokeWidth: 2 }} isAnimationActive={false} />
                <Line data={rise} dataKey="observed" name="p_rise_30" stroke={t.persistence} strokeWidth={2}
                      dot={{ r: 4, fill: t.persistence, stroke: t.surface, strokeWidth: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}
