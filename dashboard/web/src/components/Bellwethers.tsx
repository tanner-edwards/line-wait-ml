import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtHourTick, fmtTime, hourTicks, ms, num } from '../format';
import { useChartTheme } from '../theme';
import type { Bellwether } from '../types';
import { Card, Empty, Legend } from './Card';
import { axisProps, tooltipProps } from './tooltip';

interface Props {
  rides: Bellwether[];
  horizon: number;
  /** Shared x-domain so every small multiple lines up. */
  domain: [number, number] | null;
}

export function Bellwethers({ rides, horizon, domain }: Props) {
  const t = useChartTheme();
  return (
    <Card
      title="Bellwethers"
      sub={`Posted wait vs the t${horizon} forecast, drawn at the time it was forecast for`}
      className="span-all"
      table={() => <BellwetherTable rides={rides} />}
    >
      <Legend items={[
        { label: 'Actual', color: t.actual },
        { label: `t${horizon} forecast`, color: t.forecast },
      ]} />
      <div className="mini-grid">
        {rides.map((r) => <Mini key={r.ride_id} ride={r} horizon={horizon} domain={domain} />)}
      </div>
    </Card>
  );
}

function Mini({ ride, horizon, domain }: { ride: Bellwether; horizon: number; domain: [number, number] | null }) {
  const t = useChartTheme();
  const actual = ride.actual.map((p) => ({ x: ms(p.at), y: p.status === 'OPERATING' ? p.wait : null }));
  const forecast = (ride.forecasts[String(horizon)] ?? []).map((p) => ({ x: ms(p.at), y: p.value }));
  const err = ride.mae?.[String(horizon)];
  return (
    <div className="mini">
      <h4>
        {ride.ride_name ?? 'Not reporting'}
        <span>{err == null ? '' : `MAE ${num(err)}m`}</span>
      </h4>
      {actual.length === 0 ? (
        <Empty>No data</Empty>
      ) : (
        <div className="chart small">
          <ResponsiveContainer>
            <LineChart margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={t.grid} />
              <XAxis dataKey="x" type="number" domain={domain ?? ['dataMin', 'dataMax']}
                     ticks={domain ? hourTicks(domain, 4) : undefined}
                     tickFormatter={fmtHourTick} {...axisProps(t)} allowDuplicatedCategory={false} />
              <YAxis width={30} {...axisProps(t)} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipProps(t)} labelFormatter={(v) => fmtTime(v as number)}
                       formatter={(v, name) => [`${num(v as number)} min`, name]} />
              <Line data={actual} dataKey="y" name="Actual" stroke={t.actual} strokeWidth={2} dot={false}
                    activeDot={{ r: 4, stroke: t.surface, strokeWidth: 2 }} isAnimationActive={false} />
              <Line data={forecast} dataKey="y" name={`t${horizon} forecast`} stroke={t.forecast} strokeWidth={2}
                    dot={false} activeDot={{ r: 4, stroke: t.surface, strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function BellwetherTable({ rides }: { rides: Bellwether[] }) {
  const horizons = Array.from(new Set(rides.flatMap((r) => Object.keys(r.mae ?? {})))).sort((a, b) => +a - +b);
  return (
    <table>
      <thead>
        <tr><th>Ride</th><th className="n">Latest</th>{horizons.map((h) => <th key={h} className="n">t{h} MAE</th>)}</tr>
      </thead>
      <tbody>
        {rides.map((r) => {
          const last = [...r.actual].reverse().find((p) => p.wait != null);
          return (
            <tr key={r.ride_id}>
              <td>{r.ride_name ?? r.ride_id.slice(0, 8)}</td>
              <td className="n">{last ? `${num(last.wait)} @ ${fmtTime(last.at)}` : '—'}</td>
              {horizons.map((h) => <td key={h} className="n">{num(r.mae?.[h])}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
