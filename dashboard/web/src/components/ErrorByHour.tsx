import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtClockHour, fmtTime, num } from '../format';
import { useChartTheme } from '../theme';
import type { HourError } from '../types';
import { Card, Empty } from './Card';
import { endLabel } from './chartLabels';
import { axisProps, tooltipProps } from './tooltip';

/** Hours with fewer graded forecasts than this are drawn faint: one miss can swing them. */
const THIN_N = 5;

const LA_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' });

interface DotArgs { cx?: number; cy?: number; index?: number; payload?: HourError }

function faintDot({ cx, cy, index, payload }: DotArgs, fill: string, stroke: string) {
  return (
    <circle key={index} cx={cx} cy={cy} r={4} fill={fill} stroke={stroke} strokeWidth={2}
            opacity={payload && payload.n < THIN_N ? 0.35 : 1} />
  );
}

export function ErrorByHour({ rows, horizon, deploys }: {
  rows: HourError[]; horizon: number; deploys: { model_version: string; at: string }[];
}) {
  const t = useChartTheme();
  const data = rows.filter((r) => r.horizon === horizon).sort((a, b) => a.hour - b.hour);
  return (
    <Card
      title="Error through the day"
      sub={`t${horizon} MAE by the hour the forecast was made — is accuracy holding or slipping? Faint points have under ${THIN_N} forecasts.`}
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
          <div className="chart">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 6, right: 84, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={t.grid} />
                <XAxis dataKey="hour" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtClockHour}
                       {...axisProps(t)} allowDecimals={false} />
                <YAxis width={30} {...axisProps(t)} axisLine={false} />
                <Tooltip {...tooltipProps(t)} labelFormatter={(h) => fmtClockHour(h as number)}
                         formatter={(v, name, item) => [`${num(v as number)} min (n=${item.payload.n})`, name]} />
                {deploys.map((d) => (
                  <ReferenceLine key={d.at} x={+LA_HOUR.format(new Date(d.at))} stroke={t.typical}
                                 label={{ value: `deploy ${fmtTime(d.at)}`, fill: t.muted, fontSize: 11, position: 'insideTopLeft' }} />
                ))}
                <Line dataKey="mae" name="Model" stroke={t.forecast} strokeWidth={2}
                      dot={(p: DotArgs) => faintDot(p, t.forecast, t.surface)} isAnimationActive={false}
                      label={endLabel('Model', t.forecast, data.length - 1)} />
                <Line dataKey="mae_persistence" name="Persistence" stroke={t.persistence} strokeWidth={2}
                      dot={(p: DotArgs) => faintDot(p, t.persistence, t.surface)} isAnimationActive={false}
                      label={endLabel('Persistence', t.persistence, data.length - 1)} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}
