// Run-level numbers shared by the HTML report and history page.
import { mean, pct } from './parse';

export interface MetricRecord {
  error?: string; wallMs?: number; outputTokens?: number | null; parsed: boolean;
  hardFailures: string[]; softFailures: string[]; checksRun: { hard: number; soft: number };
}

export function metrics(rs: MetricRecord[]) {
  const ok = rs.filter(r => !r.error);
  const lat = ok.map(r => r.wallMs).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  const out = ok.map(r => r.outputTokens).filter((x): x is number => typeof x === 'number');
  const hardRun = ok.reduce((n, r) => n + r.checksRun.hard, 0), hardFail = ok.reduce((n, r) => n + r.hardFailures.length, 0);
  const softRun = ok.reduce((n, r) => n + r.checksRun.soft, 0), softFail = ok.reduce((n, r) => n + r.softFailures.length, 0);
  return {
    calls: rs.length,
    errors: rs.length - ok.length,
    p50Ms: lat.length ? Math.round(pct(lat, 50)) : NaN,
    p95Ms: lat.length ? Math.round(pct(lat, 95)) : NaN,
    outTokens: out.length ? Math.round(mean(out)) : NaN,
    jsonOkPct: ok.length ? Math.round((100 * ok.filter(r => r.parsed).length) / ok.length) : NaN,
    hardPassPct: hardRun ? Math.round((1000 * (hardRun - hardFail)) / hardRun) / 10 : NaN,
    softPassPct: softRun ? Math.round((1000 * (softRun - softFail)) / softRun) / 10 : NaN,
    cleanRuns: ok.filter(r => r.parsed && r.hardFailures.length === 0).length,
  };
}
