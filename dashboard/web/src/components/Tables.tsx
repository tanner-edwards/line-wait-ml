import { useState } from 'react';
import { fmtTime, num, signed } from '../format';
import type { Graded, ParkGrade } from '../types';
import { Card, Empty } from './Card';
import { HorizonTable } from './Headline';

export function Slices({ park }: { park: Graded }) {
  const [which, setWhich] = useState<'closing' | 'post_reopen' | 'version'>('closing');
  const versions = park.by_model_version;
  return (
    <Card title="Hard spots" sub="Closing hour taper, the hour after a reopen, and per model version">
      <div className="seg on-surface" style={{ marginBottom: 8 }}>
        <button aria-pressed={which === 'closing'} onClick={() => setWhich('closing')}>Closing hour</button>
        <button aria-pressed={which === 'post_reopen'} onClick={() => setWhich('post_reopen')}>After reopen</button>
        {versions.length > 0 && (
          <button aria-pressed={which === 'version'} onClick={() => setWhich('version')}>By model</button>
        )}
      </div>
      <div className="table-wrap">
        {which === 'version'
          ? versions.map((v) => (
              <div key={v.model_version} style={{ marginBottom: 10 }}>
                <div className="sub" style={{ margin: '4px 0' }}>Model {v.model_version}</div>
                <HorizonTable scores={v.headline} />
              </div>
            ))
          : <HorizonTable scores={park.slices[which]} />}
      </div>
    </Card>
  );
}

export function WorstMisses({ misses }: { misses: ParkGrade['worst_misses'] }) {
  return (
    <Card title="Worst misses" sub="Largest single errors at any horizon">
      {misses.length === 0 ? <Empty>Nothing graded yet.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ride</th><th>Made</th><th className="n">h</th><th className="n">Said</th><th className="n">Was</th><th className="n">Off</th></tr></thead>
            <tbody>
              {misses.map((m, i) => (
                <tr key={i}>
                  <td>{m.ride_name}</td><td>{fmtTime(m.at)}</td><td className="n">t{m.horizon}</td>
                  <td className="n">{num(m.forecast)}</td><td className="n">{num(m.actual)}</td>
                  <td className="n">{signed(m.err)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function RideAverages({ rows }: { rows: ParkGrade['ride_averages'] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <Card title="Average wait by ride" sub="Operating polls only, walk-on normalized">
      {rows.length === 0 ? <Empty>No operating rides yet.</Empty> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ride</th><th>Tier</th><th className="n">Avg</th><th className="n">Min</th><th className="n">Max</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.ride_id}>
                    <td>{r.ride_name}</td><td className="sub" style={{ textTransform: 'capitalize' }}>{r.tier}</td>
                    <td className="n">{num(r.avg, 0)}</td>
                    <td className="n">{num(r.min, 0)}</td><td className="n">{num(r.max, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 8 && (
            <button className="link-btn" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
          )}
        </>
      )}
    </Card>
  );
}
