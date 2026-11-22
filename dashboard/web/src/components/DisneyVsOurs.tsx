import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtClockHour, num, signed } from '../format';
import { useChartTheme } from '../theme';
import type { DisneyVsOurs as Data, DvoScore } from '../types';
import { Card, Empty, Legend } from './Card';
import { axisProps, tooltipProps } from './tooltip';

/** Day after: Disney's published day forecast vs ours vs what was posted.
 *  For watching who is closer over a few weeks; nothing acts on it. */
export function DisneyVsOurs({ data }: { data: Data }) {
  const t = useChartTheme();
  const yTop = Math.ceil(Math.max(10, ...data.rides.flatMap((r) => r.hours.flatMap((h) => [h.disney ?? 0, h.ours ?? 0, h.actual ?? 0]))) / 10) * 10;
  const snap = data.disney_snapshot_hours.map((h) => fmtClockHour(+h)).join(', ') || '—';
  return (
    <Card
      title="Disney's forecast vs ours"
      sub={`Day forecasts as of park open (Disney's ${snap} snapshot; ours rebuilt with model ${data.model_version}`
        + `${data.weather_fallback ? ', weather unknown' : ''}) vs the hourly mean posted wait. Every ride shares one scale (0–${yTop} min).`}
      className="span-all"
      table={() => <DvoTable data={data} />}
    >
      <div className="dvo-score"><Scorecard data={data} /></div>
      <Legend items={[
        { label: 'Disney', color: t.disney, kind: 'dot' },
        { label: 'Ours', color: t.forecast, kind: 'dot' },
        { label: 'Actual', color: t.actual },
      ]} />
      <div className="mini-grid">
        {data.rides.map((r) => <Mini key={r.ride_id} ride={r} yTop={yTop} />)}
      </div>
    </Card>
  );
}

function Scorecard({ data }: { data: Data }) {
  const rows: (DvoScore & { block: string })[] = [{ block: 'All hours', ...data.scorecard.all }, ...data.scorecard.blocks];
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{data.scorecard.all.rides} rides</th><th className="n">Hours</th>
            <th className="n">Disney MAE</th><th className="n">Ours MAE</th>
            <th className="n">Disney lean</th><th className="n">Ours lean</th><th className="n">Ours closer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.block}>
              <td>{r.block}</td><td className="n">{r.n}</td>
              <td className="n">{num(r.mae_disney)}</td><td className="n">{num(r.mae_ours)}</td>
              <td className="n">{signed(r.bias_disney)}</td><td className="n">{signed(r.bias_ours)}</td>
              <td className="n">{r.ours_closer_pct == null ? '—' : `${r.ours_closer_pct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Mini({ ride, yTop }: { ride: Data['rides'][number]; yTop: number }) {
  const t = useChartTheme();
  const rows = ride.hours.map((h) => ({ ...h, label: fmtClockHour(h.hour) }));
  return (
    <div className="mini">
      <h4>
        {ride.ride_name ?? ride.ride_id.slice(0, 8)}
        <span>{ride.has_disney ? '' : 'No Disney forecast'}</span>
      </h4>
      {rows.length === 0 ? (
        <Empty>No data</Empty>
      ) : (
        <div className="chart small">
          <ResponsiveContainer>
            <ComposedChart data={rows} barGap={2} barCategoryGap="20%" margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={t.grid} />
              <XAxis dataKey="label" {...axisProps(t)} interval="preserveStartEnd" minTickGap={8} />
              <YAxis width={30} domain={[0, yTop]} {...axisProps(t)} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipProps(t)} cursor={{ fill: t.grid }}
                       formatter={(v, name) => [v == null ? '—' : `${num(v as number)} min`, name]} />
              {ride.has_disney && (
                <Bar dataKey="disney" name="Disney" fill={t.disney} isAnimationActive={false} />
              )}
              <Bar dataKey="ours" name="Ours" fill={t.forecast} isAnimationActive={false} />
              <Line dataKey="actual" name="Actual" stroke={t.actual} strokeWidth={2} connectNulls={false}
                    dot={{ r: 3, fill: t.actual, stroke: t.surface, strokeWidth: 1 }}
                    activeDot={{ r: 4, stroke: t.surface, strokeWidth: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function DvoTable({ data }: { data: Data }) {
  return (
    <table>
      <thead>
        <tr><th>Ride</th><th className="n">Hour</th><th className="n">Disney</th><th className="n">Ours</th><th className="n">Actual</th></tr>
      </thead>
      <tbody>
        {data.rides.flatMap((r) => r.hours.map((h) => (
          <tr key={`${r.ride_id}-${h.hour}`}>
            <td>{r.ride_name ?? r.ride_id.slice(0, 8)}</td>
            <td className="n">{fmtClockHour(h.hour)}</td>
            <td className="n">{num(h.disney)}</td><td className="n">{num(h.ours)}</td><td className="n">{num(h.actual)}</td>
          </tr>
        )))}
      </tbody>
    </table>
  );
}
