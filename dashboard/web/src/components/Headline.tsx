import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { num, pct, signed } from '../format';
import { useChartTheme } from '../theme';
import type { HorizonScore } from '../types';
import { Card, Empty, Legend } from './Card';
import { axisProps, tooltipProps } from './tooltip';

/** The one hero number per park: MAE at the selected horizon vs "wait stays the same". */
export function Headline({ scores, horizon }: { scores: HorizonScore[]; horizon: number }) {
  const t = useChartTheme();
  const graded = scores.filter((s) => s.n > 0);
  const sel = scores.find((s) => s.horizon === horizon);
  const data = graded.map((s) => ({ name: `t${s.horizon}`, model: s.mae, persistence: s.mae_persistence }));

  return (
    <Card
      title="Forecast accuracy"
      sub="Mean absolute error in minutes, on the same rows as the persistence baseline"
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
        <div style={{ marginTop: 16 }}>
          <Legend items={[{ label: 'Model', color: t.forecast }, { label: 'Persistence', color: t.persistence }]} />
          <div className="chart small">
            <ResponsiveContainer>
              <BarChart data={data} barGap={2} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke={t.grid} />
                <XAxis dataKey="name" {...axisProps(t)} />
                <YAxis width={32} {...axisProps(t)} axisLine={false} />
                <Tooltip {...tooltipProps(t)} cursor={{ fill: t.grid }}
                         formatter={(v) => `${num(v as number)} min`} />
                <Bar dataKey="model" name="Model" fill={t.forecast} maxBarSize={24} radius={[4, 4, 0, 0]} />
                <Bar dataKey="persistence" name="Persistence" fill={t.persistence} maxBarSize={24} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
