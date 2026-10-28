import { useState } from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { fmtTime, num, signed } from '../format';
import { useChartTheme } from '../theme';
import type { Anomaly, Closure } from '../types';
import { Card, Empty } from './Card';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'big_miss', label: 'Misses' },
  { key: 'fall_call', label: 'Fall calls' },
  { key: 'unusual', label: 'Unusual' },
] as const;

export function Anomalies({ items }: { items: Anomaly[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const shown = (filter === 'all' ? items : items.filter((a) => a.type === filter)).slice().reverse();
  return (
    <Card title="Anomalies" sub="Where the model was surprised, or the wait left its normal range">
      <div className="seg on-surface" style={{ marginBottom: 8 }}>
        {FILTERS.map((f) => {
          const n = f.key === 'all' ? items.length : items.filter((a) => a.type === f.key).length;
          return (
            <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} {n > 0 && <span style={{ opacity: 0.6 }}>{n}</span>}
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <Empty>Nothing flagged.</Empty>
      ) : (
        <ul className="feed">
          {shown.map((a, i) => <AnomalyRow key={`${a.type}-${a.ride_id}-${a.at}-${i}`} a={a} />)}
        </ul>
      )}
    </Card>
  );
}

function AnomalyRow({ a }: { a: Anomaly }) {
  let badge, detail;
  if (a.type === 'big_miss') {
    badge = <span className="badge skip">✕ Miss</span>;
    detail = `t${a.horizon} said ${num(a.forecast)}, was ${num(a.actual)} (${signed(a.err)} min) · from ${num(a.wait)} at ${fmtTime(a.at)}`;
  } else if (a.type === 'fall_call') {
    badge = a.fell == null ? <span className="badge neutral">↓ Fall call · pending</span>
      : a.fell ? <span className="badge go">✓ Fall call · fell</span>
      : <span className="badge caution">↓ Fall call · didn't fall</span>;
    detail = `p_fall ${Math.round(a.p_fall_30 * 100)}% (≥${Math.round(a.threshold * 100)}%) at ${num(a.wait)} min` +
      (a.actual_t30 == null ? '' : ` → ${num(a.actual_t30)} by T+30`);
  } else {
    badge = <span className={`badge ${a.side === 'high' ? 'star' : 'neutral'}`}>{a.side === 'high' ? '▲ High' : '▼ Low'}</span>;
    detail = `peaked ${num(a.peak)} vs typical ${num(a.p10)}–${num(a.p90)} · ${a.polls} poll${a.polls === 1 ? '' : 's'}` +
      (a.until !== a.at ? ` until ${fmtTime(a.until)}` : '');
  }
  return (
    <li>
      <span className="when">{fmtTime(a.at)}</span>
      <div>
        <div className="what">{badge} {a.ride_name}</div>
        <div className="detail">{detail}</div>
      </div>
    </li>
  );
}

export function Closures({ items }: { items: Closure[] }) {
  const t = useChartTheme();
  const shown = items.slice().reverse();
  return (
    <Card title="Closures" sub="Not anomalies — logged with duration and how waits came back after reopening">
      {shown.length === 0 ? (
        <Empty>No closures.</Empty>
      ) : (
        <ul className="feed">
          {shown.map((c, i) => (
            <li key={`${c.ride_id}-${c.closed_at}-${i}`}>
              <span className="when">{c.closed_at ? fmtTime(c.closed_at) : '—'}</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 8, alignItems: 'center' }}>
                <div>
                  <div className="what">
                    {c.open ? <span className="badge skip">● Down now</span>
                      : <span className="badge neutral">{num(c.duration_min, 0)} min</span>} {c.ride_name}
                  </div>
                  <div className="detail">
                    {c.open ? (c.wait_at_close == null ? 'closed, wait before closing unknown' : `wait was ${num(c.wait_at_close)} at close`)
                      : `${num(c.wait_at_close)} at close → ${num(c.wait_at_reopen)} on reopen ${c.reopened_at ? fmtTime(c.reopened_at) : ''}`}
                  </div>
                </div>
                {c.recovery.length > 1 && (
                  <div style={{ height: 32 }} title="Wait over the hour after reopening">
                    <ResponsiveContainer>
                      <LineChart data={c.recovery}>
                        <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
                        <Line dataKey="wait" stroke={t.muted} strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
