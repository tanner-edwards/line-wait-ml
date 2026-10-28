import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtClockHour, fmtTime, num } from '../format';
import { useChartTheme } from '../theme';
import type { HourError } from '../types';
import { Card, Empty, Legend } from './Card';
import { axisProps, tooltipProps } from './tooltip';

const LA_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' });

export function ErrorByHour({ rows, horizon, deploys }: {
  rows: HourError[]; horizon: number; deploys: { model_version: string; at: string }[];
}) {
  const t = useChartTheme();
  const data = rows.filter((r) => r.horizon === horizon).sort((a, b) => a.hour - b.hour);
  return (
    <Card
      title="Error through the day"
      sub={`t${horizon} MAE by the hour the forecast was made — is accuracy holding or slipping?`}
      table={() => (
        <table>
          <thead><tr><th>Hour</th><th className="n">n</th><th className="n">Model</th><th className="n">Persist.</th></tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.hour}>
                <td>{fmtClockHour(r.hour)}</td><td className="n">{r.n}</td>
                <td className="n">{num(r.mae)}</td><td className="n">{num(r.mae_persistence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    >
      {data.length < 2 ? (
        <Empty>Needs at least two hours of graded t{horizon} forecasts.</Empty>
      ) : (
        <>
          <Legend items={[
            { label: 'Model', color: t.forecast },
            { label: 'Persistence', color: t.persistence },
            ...(deploys.length ? [{ label: 'Model deploy', color: t.typical, kind: 'ref' as const }] : []),
          ]} />
          <div className="chart">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={t.grid} />
                <XAxis dataKey="hour" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtClockHour}
                       {...axisProps(t)} allowDecimals={false} />
                <YAxis width={30} {...axisProps(t)} axisLine={false} />
                <Tooltip {...tooltipProps(t)} labelFormatter={(h) => fmtClockHour(h as number)}
                         formatter={(v, name) => [`${num(v as number)} min`, name]} />
                {deploys.map((d) => (
                  <ReferenceLine key={d.at} x={+LA_HOUR.format(new Date(d.at))} stroke={t.typical}
                                 label={{ value: `deploy ${fmtTime(d.at)}`, fill: t.muted, fontSize: 11, position: 'insideTopLeft' }} />
                ))}
                <Line dataKey="mae" name="Model" stroke={t.forecast} strokeWidth={2}
                      dot={{ r: 4, fill: t.forecast, stroke: t.surface, strokeWidth: 2 }} isAnimationActive={false} />
                <Line dataKey="mae_persistence" name="Persistence" stroke={t.persistence} strokeWidth={2}
                      dot={{ r: 4, fill: t.persistence, stroke: t.surface, strokeWidth: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}
