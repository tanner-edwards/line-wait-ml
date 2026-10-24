import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { fetchLive, fetchRecap, getKey, setKey, UnauthorizedError } from './api';
import { ParkColumn } from './components/ParkColumn';
import { fmtDate, fmtTime, laDate } from './format';
import type { DayGrade } from './types';

const HORIZONS = [30, 60, 120, 180, 240];
type Mode = 'today' | 'recap';

export function App() {
  const [key, setKeyState] = useState<string | null>(getKey);
  if (!key) {
    return <KeyGate onKey={(k) => { setKey(k); setKeyState(k); }} />;
  }
  return <Dashboard adminKey={key} onUnauthorized={() => { setKey(null); setKeyState(null); }} />;
}

function KeyGate({ onKey }: { onKey: (k: string) => void }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) onKey(value.trim());
  };
  return (
    <div className="gate">
      <form onSubmit={submit}>
        <h1>Club 32 Monitor</h1>
        <p>Enter the admin key. It's saved in this browser only.</p>
        <input type="password" autoComplete="current-password" value={value}
               onChange={(e) => setValue(e.target.value)} placeholder="Admin key" autoFocus />
        <button className="btn" type="submit">Open dashboard</button>
      </form>
    </div>
  );
}

function Dashboard({ adminKey, onUnauthorized }: { adminKey: string; onUnauthorized: () => void }) {
  const [mode, setMode] = useState<Mode>('today');
  const [date, setDate] = useState(() => laDate(-1));
  const [horizon, setHorizon] = useState(60);
  const [parkId, setParkId] = useState<string | null>(null);
  const [data, setData] = useState<DayGrade | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = mode === 'today' ? await fetchLive(adminKey) : await fetchRecap(adminKey, date);
      setData(next);
    } catch (e) {
      if (e instanceof UnauthorizedError) onUnauthorized();
      else setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [mode, date, adminKey, onUnauthorized]);

  useEffect(() => { void load(); }, [load]);

  const parks = data ? Object.values(data.parks) : [];
  const selected = parks.find((p) => p.park_id === parkId) ?? parks[0];

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <h1>Club 32 Monitor</h1>
            <span>{data ? `${fmtDate(data.date)} · ${data.day_type}` : 'Prediction accuracy'}</span>
          </div>
          <div className="header-controls">
            <div className="seg" role="group" aria-label="View">
              <button aria-pressed={mode === 'today'} onClick={() => setMode('today')}>Today</button>
              <button aria-pressed={mode === 'recap'} onClick={() => setMode('recap')}>Past day</button>
            </div>
            {mode === 'recap' && (
              <input className="date-input" type="date" value={date} min={laDate(-30)} max={laDate(-1)}
                     onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
            )}
            <button className="btn" onClick={() => void load()} disabled={loading}>
              {loading ? 'Grading…' : 'Refresh'}
            </button>
            {data && <span className="asof">as of {fmtTime(data.generated_at)}</span>}
            <button className="btn ghost" onClick={onUnauthorized} title="Forget the admin key on this device">Sign out</button>
          </div>
        </div>
      </header>

      <main className="page">
        {error && <div className="error-banner">{error}</div>}

        <div className="toolbar">
          <span className="label">Horizon</span>
          <div className="seg on-surface" role="group" aria-label="Forecast horizon">
            {HORIZONS.map((h) => (
              <button key={h} aria-pressed={horizon === h} onClick={() => setHorizon(h)}>
                {h < 60 ? `${h}m` : `${h / 60}h`}
              </button>
            ))}
          </div>
          {parks.length > 1 && (
            <div className="seg on-surface park-toggle" role="group" aria-label="Park">
              {parks.map((p) => (
                <button key={p.park_id} aria-pressed={selected?.park_id === p.park_id} onClick={() => setParkId(p.park_id)}>
                  {p.park_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {!data && loading && <div className="loading">Grading {mode === 'today' ? 'today' : fmtDate(date)}…</div>}

        {data && (
          <>
            {/* Wide screens: both parks side by side. Narrower: the toggled park only. */}
            <div className="parks both wide-only">
              {parks.map((p) => <ParkColumn key={p.park_id} park={p} horizon={horizon} live={mode === 'today'} />)}
            </div>
            {selected && (
              <div className="parks narrow-only">
                <ParkColumn park={selected} horizon={horizon} live={mode === 'today'} />
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
