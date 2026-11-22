import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtHourTick, fmtTime, hourTicks, ms, num } from '../format';
import { useChartTheme } from '../theme';
import type { ParkGrade } from '../types';
import { Card, Empty } from './Card';
import { axisProps, tooltipProps } from './tooltip';

const describe = (r: number | null) =>
  r == null ? '' : r >= 1.1 ? 'busier than typical' : r <= 0.9 ? 'quieter than typical' : 'about typical';

export function Crowd({ crowd, domain }: { crowd: ParkGrade['crowd']; domain: [number, number] | null }) {
  const t = useChartTheme();
  const data = crowd.ratio.map((p) => ({ x: ms(p.at), ratio: p.ratio }));
  const latest = [...crowd.ratio].reverse().find((p) => p.ratio != null) ?? null;
  const graded = data.filter((d) => d.ratio != null);
  const values = graded.map((d) => d.ratio as number);
  const lo = Math.min(0.8, ...values), hi = Math.max(1.2, ...values);

  return (
    <Card
      title={latest ? `Crowd is ${describe(latest.ratio)}` : 'Crowd level'}
      sub="Crowd level: summed waits over the last 2 h vs a typical day at this hour (1.0 = typical)"
      table={() => (
        <table>
          <thead><tr><th>Time</th><th className="n">Ratio</th></tr></thead>
          <tbody>{graded.map((d) => <tr key={d.x}><td>{fmtTime(d.x)}</td><td className="n">{num(d.ratio, 2)}</td></tr>)}</tbody>
        </table>
      )}
    >
      <p className="sub" style={{ margin: '0 0 8px' }}>
        {latest ? `Live ${num(latest.ratio, 2)} at ${fmtTime(latest.at)}` : 'Live ratio starts after 10am'}
        {' · '}
        {crowd.morning_index == null
          ? 'morning index after the first 2 h'
          : `morning index ${num(crowd.morning_index, 2)} (${describe(crowd.morning_index)})`}
      </p>
      {graded.length < 2 ? (
        <Empty>The live ratio starts at 10am, once 8+ rides are reporting.</Empty>
      ) : (
        <div className="chart small">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={t.grid} />
              <XAxis dataKey="x" type="number" domain={domain ?? ['dataMin', 'dataMax']}
                     ticks={domain ? hourTicks(domain) : undefined}
                     tickFormatter={fmtHourTick} {...axisProps(t)} />
              <YAxis width={34} domain={[Math.floor(lo * 10) / 10, Math.ceil(hi * 10) / 10]}
                     {...axisProps(t)} axisLine={false} tickFormatter={(v) => num(v, 1)} />
              <Tooltip {...tooltipProps(t)} labelFormatter={(v) => fmtTime(v as number)}
                       formatter={(v) => [num(v as number, 2), 'Crowd ratio']} />
              <ReferenceLine y={1} stroke={t.typical}
                             label={{ value: 'typical', fill: t.muted, fontSize: 11, position: 'insideTopRight' }} />
              <Line dataKey="ratio" stroke={t.actual} strokeWidth={2} dot={false}
                    connectNulls={false} isAnimationActive={false}
                    activeDot={{ r: 4, stroke: t.surface, strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
