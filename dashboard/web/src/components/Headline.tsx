import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { num, pct, signed } from '../format';
import { useChartTheme } from '../theme';
import type { HorizonScore } from '../types';
import { Card, Empty } from './Card';
import { endLabel } from './chartLabels';
import { axisProps, tooltipProps } from './tooltip';

/** The one hero number per park: MAE at the selected horizon vs "wait stays the same". */
export function Headline({ scores, horizon }: { scores: HorizonScore[]; horizon: number }) {
  const t = useChartTheme();
  const graded = scores.filter((s) => s.n > 0);
  const sel = scores.find((s) => s.horizon === horizon);
  const data = graded.map((s) => ({ horizon: s.horizon, model: s.mae, persistence: s.mae_persistence }));
  const lift = sel?.lift_pct;
  const title = sel && sel.n > 0 && lift != null
    ? `Model ${lift >= 0 ? 'beats' : 'trails'} "wait stays the same" by ${Math.abs(Math.round(lift))}% at t${horizon}`
    : 'Forecast accuracy';

  return (
    <Card
      title={title}
      sub="Forecast accuracy: mean absolute error in minutes, on the same rows as the persistence baseline"
      className="span-all"
      table={() => <HorizonTable scores={scores} />}
    >
      {!sel || sel.n === 0 ? (
        <Empty>No t{horizon} forecasts have come due yet.</Empty>
      ) : (
        <>
          <div className="hero">
            <div>
              <div className="hero-label">t{horizon} MAE</div>
              <div className="hero-value">
                {num(sel.mae)}
                <small>min</small>
              </div>
            </div>
            <div className="hero-label">
              Persistence {num(sel.mae_persistence)} min ·{' '}
              <span className={(sel.lift_pct ?? 0) >= 0 ? 'good' : 'bad'}>
                {signed(sel.lift_pct, 0)}% lift
              </span>{' '}
              · {sel.n} forecasts
            </div>
          </div>
          <div className="tiles">
            <Tile label={`Within ±${sel.tolerance} min`} value={pct(sel.hit_rate)}
                  delta={`baseline ${pct(sel.hit_rate_persistence)}`}
                  good={(sel.hit_rate ?? 0) >= (sel.hit_rate_persistence ?? 0)} />
            {graded.filter((s) => s.horizon !== horizon).slice(0, 3).map((s) => (
              <Tile key={s.horizon} label={`t${s.horizon} MAE`} value={`${num(s.mae)}m`}
                    delta={`${signed(s.lift_pct, 0)}% vs base`} good={(s.lift_pct ?? 0) >= 0} />
            ))}
          </div>
        </>
      )}
      {data.length > 1 && (
        <div className="chart small" style={{ marginTop: 16 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 6, right: 84, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={t.grid} />
              <XAxis dataKey="horizon" type="number" domain={['dataMin', 'dataMax']}
                     ticks={data.map((d) => d.horizon)} tickFormatter={(h) => `t${h}`} {...axisProps(t)} />
              <YAxis width={32} domain={[0, 'auto']} {...axisProps(t)} axisLine={false} />
              <Tooltip {...tooltipProps(t)} labelFormatter={(h) => `t${h}`}
                       formatter={(v, name) => [`${num(v as number)} min`, name]} />
              <Line dataKey="persistence" name="Persistence" stroke={t.persistence} strokeWidth={2}
                    dot={{ r: 4, fill: t.persistence, stroke: t.surface, strokeWidth: 2 }} isAnimationActive={false}
                    label={endLabel('Persistence', t.persistence, data.length - 1)} />
              <Line dataKey="model" name="Model" stroke={t.forecast} strokeWidth={2}
                    dot={{ r: 4, fill: t.forecast, stroke: t.surface, strokeWidth: 2 }} isAnimationActive={false}
                    label={endLabel('Model', t.forecast, data.length - 1)} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Tile({ label, value, delta, good }: { label: string; value: string; delta: string; good: boolean }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className={`delta ${good ? 'good' : 'bad'}`}>{delta}</div>
    </div>
  );
}

export function HorizonTable({ scores }: { scores: HorizonScore[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Horizon</th><th className="n">n</th><th className="n">MAE</th><th className="n">Persist.</th>
          <th className="n">Lift</th><th className="n">Hit</th><th className="n">Base hit</th>
        </tr>
      </thead>
      <tbody>
        {scores.map((s) => (
          <tr key={s.horizon}>
            <td>t{s.horizon} <span className="sub">±{s.tolerance}</span></td>
            <td className="n">{s.n}</td>
            <td className="n">{num(s.mae)}</td>
            <td className="n">{num(s.mae_persistence)}</td>
            <td className="n">{s.lift_pct == null ? '—' : `${signed(s.lift_pct, 0)}%`}</td>
            <td className="n">{pct(s.hit_rate)}</td>
            <td className="n">{pct(s.hit_rate_persistence)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
