// Side-by-side comparison of judged runs, one column per model (or per file with --by-file).
//
//   npm run compare -- site/data/<run>.json site/data/<run>.json ...
//   npm run compare -- --latest 6          # the six most recent judged runs
//
// Runs with the same model are merged (scenarios + live personas run as separate
// invocations). Prices are per million tokens, standard tier, 2026-11-20.

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { arg, flag, EVALS_ROOT } from './args';
import { buildFixture, rideMeta } from './fixtures/derive';
import { fixtureById } from './fixtures/scenarios';
import { grade } from './grade';
import { DEFERS } from '../../app/backend/src/recommendations/handler';
import { fitsPreference } from './checks';
import { PERSONA_PRESETS } from './personas';
import { variety } from './variety';
import { DerivedRide, Fixture, RunRecord } from './types';
import { Judgement } from './judge';

interface RunData { runId: string; model: string; variant: string; records: RunRecord[]; judgements: Judgement[] }

const PRICES: [RegExp, [number, number]][] = [
  [/gpt-6-luna/, [0.1, 0.5]], [/gpt-6\.1-terra/, [1, 5]], [/gpt-6\.1-sol/, [2, 10]],
  [/haiku-5-5/, [0.1, 0.5]], [/haiku-4-5/, [1, 5]], [/sonnet-5-5|sonnet-5\b/, [2, 10]], [/sonnet-4-6/, [3, 15]],
];
const priceFor = (m: string) => PRICES.find(([re]) => re.test(m))?.[1] ?? [NaN, NaN];
const READOUT = /\b(\d+|five|ten|fifteen|twenty|thirty)([- ]?min(ute)?s?\b|\s+(with|in line|is|ahead))(?! (walk|away|from|long|start|ride))/i;
const SCALE = /\b(thrill\w*|intense|motion ride|moderate-high)\b/i;
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pct = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length * 0.95)] : NaN; };

function loadFixture(id: string): Fixture {
  try { return fixtureById(id); } catch { /* live */ }
  const p = join(EVALS_ROOT, 'live', `${id}.json`);
  if (!existsSync(p)) throw new Error(`fixture ${id} not found (not a scenario, no evals/live/${id}.json)`);
  return JSON.parse(readFileSync(p, 'utf8')) as Fixture;
}

function files(): string[] {
  const given = process.argv.slice(2).filter(a => a.endsWith('.json'));
  if (given.length) return given;
  const n = Number(arg('latest', '0'));
  const dir = join(EVALS_ROOT, 'site', 'data');
  const all = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!n) throw new Error('pass site/data/*.json files or --latest N');
  return all.slice(0, n);
}

interface Col { key: string; models: Set<string>; runs: RunData[] }

function main() {
  const byFile = flag('by-file');
  const cols = new Map<string, Col>();
  for (const f of files()) {
    const d = JSON.parse(readFileSync(f, 'utf8')) as RunData;
    const key = byFile ? d.runId : d.model.replace(/^(us|global)\.anthropic\.|^(us|global)\.openai\./, '').replace(/-\d{8}-v\d:\d$/, '');
    const c = cols.get(key) ?? { key, models: new Set(), runs: [] };
    c.models.add(d.model); c.runs.push(d); cols.set(key, c);
  }

  const rows: Record<string, string[]> = {};
  const push = (k: string, v: string) => (rows[k] ??= []).push(v);
  const fx = new Map<string, ReturnType<typeof buildFixture>>();
  const built = (id: string) => { let b = fx.get(id); if (!b) { b = buildFixture(loadFixture(id)); fx.set(id, b); } return b; };

  for (const c of cols.values()) {
    const recs = c.runs.flatMap(r => r.records);
    const judgements = c.runs.flatMap(r => r.judgements ?? []);
    const ok = recs.filter(r => !r.error);
    const graded = ok.map(r => ({ rec: r, g: grade(r, built(r.fixture)) }));
    const perFixture = new Map<string, { pass: number; total: number }>();
    for (const { rec, g } of graded) { const s = perFixture.get(rec.fixture) ?? { pass: 0, total: 0 }; s.total++; if (g.passed) s.pass++; perFixture.set(rec.fixture, s); }
    const scen = [...perFixture.entries()].filter(([id]) => /^S\d/.test(id));
    const live = [...perFixture.entries()].filter(([id]) => /^LIVE/.test(id));
    const atBar = scen.filter(([, s]) => s.pass / s.total >= 0.8).length;
    const captions = graded.flatMap(({ g }) => (g.recs ?? []).map(r => r.oneLiner));
    const answers = graded.map(({ g }) => (g.recs ?? []).map(r => r.oneLiner));
    const v = variety(answers);
    const hard = new Map<string, number>();
    for (const { g } of graded) for (const ch of g.checks) if (!ch.pass && ch.severity === 'hard') hard.set(ch.id, (hard.get(ch.id) ?? 0) + 1);
    const [IN, OUT] = priceFor([...c.models][0]);
    const cost = ok.reduce((s, r) => s + (r.inputTokens ?? 0) * IN / 1e6 + (r.outputTokens ?? 0) * OUT / 1e6, 0) / Math.max(1, ok.length);
    const lens = captions.map(t => t.split(/\s+/).length);
    const judge: Record<string, { pass: number; total: number }> = {};
    for (const j of judgements) for (const [q, r] of Object.entries(j.results)) { if (!r || r.pass === null) continue; const s = judge[q] ??= { pass: 0, total: 0 }; s.total++; if (r.pass) s.pass++; }
    const judgeAll = Object.values(judge).reduce((s, x) => ({ pass: s.pass + x.pass, total: s.total + x.total }), { pass: 0, total: 0 });

    push('model', c.key);
    push('calls (errors)', `${recs.length} (${recs.length - ok.length})`);
    push('scenarios at bar', scen.length ? `${atBar}/${scen.length}` : '-');
    push('scenario runs pass', scen.length ? `${Math.round(100 * scen.reduce((s, [, x]) => s + x.pass, 0) / scen.reduce((s, [, x]) => s + x.total, 0))}%` : '-');
    push('live runs pass', live.length ? `${Math.round(100 * live.reduce((s, [, x]) => s + x.pass, 0) / live.reduce((s, [, x]) => s + x.total, 0))}%` : '-');
    // Preference lift: on the same live pool (same capture, same run), does a persona with a
    // preference answer differently from the default guest, and does a fitting ride show up in
    // its top two more often? Personas whose preference is first-time, or none, are skipped.
    {
      const topTwo = new Map<string, DerivedRide[]>();
      for (const { rec, g } of graded) if (/^LIVE/.test(rec.fixture) && g.recs) topTwo.set(`${rec.fixture}#${rec.run}`, g.recs.slice(0, 2).map(r => built(rec.fixture).byName.get(r.ride!)).filter((d): d is DerivedRide => !!d));
      let pairs = 0, differ = 0, fitP = 0, fitD = 0;
      for (const [k, mine] of topTwo) {
        const [id, run] = k.split('#');
        const b = built(id); const prefs = b.persona?.ridePreferences ?? [];
        if (!prefs.length || prefs.includes('first-time')) continue;
        const persona = PERSONA_PRESETS.find(p => id.endsWith(`-${p.key}`))?.key; if (!persona || persona === 'default') continue;
        const def = topTwo.get(`${id.slice(0, -persona.length)}default#${run}`); if (!def) continue;
        pairs++;
        if (mine.map(d => d.name).join('|') !== def.map(d => d.name).join('|')) differ++;
        if (mine.some(d => fitsPreference(d, prefs))) fitP++;
        if (def.some(d => fitsPreference(d, prefs))) fitD++;
      }
      push('pref lift (live)', pairs ? `${Math.round(100 * differ / pairs)}% differ from default; fit in top 2 ${Math.round(100 * fitP / pairs)}% vs ${Math.round(100 * fitD / pairs)}%` : '-');
    }
    push('judge pass (all q)', judgeAll.total ? `${Math.round(100 * judgeAll.pass / judgeAll.total)}%` : '-');
    for (const q of ['grounded', 'present-tense', 'skip-framing', 'restrictions', 'strongest-reason', 'voice', 'ranking']) push(`  judge ${q}`, judge[q] ? `${Math.round(100 * judge[q].pass / judge[q].total)}%` : '-');
    push('p50 / p95 s', `${(med(ok.map(r => r.wallMs!)) / 1000).toFixed(2)} / ${(pct(ok.map(r => r.wallMs!)) / 1000).toFixed(2)}`);
    push('in / out tokens p50', `${med(ok.map(r => r.inputTokens ?? 0))} / ${med(ok.map(r => r.outputTokens ?? 0))}`);
    push('cost per call', Number.isFinite(cost) ? `$${cost.toFixed(4)}` : '-');
    push('picks per answer', (captions.length / Math.max(1, graded.length)).toFixed(1));
    push('median words', String(med(lens)));
    push('over 18 words', `${lens.filter(l => l > 18).length}/${lens.length}`);
    push('minute readouts', String(captions.filter(t => READOUT.test(t)).length));
    push('scale words', String(captions.filter(t => SCALE.test(t)).length));
    push('deferrals (prod drops)', String(captions.filter(t => DEFERS.test(t)).length));
    push('distinct openers', `${Math.round(100 * v.distinctOpeners)}%`);
    push('within-answer repeat', `${Math.round(100 * v.withinRepeat)}%`);
    push('top phrase', v.topPhrases[0] ? `"${v.topPhrases[0].phrase}" x${v.topPhrases[0].count}` : '-');
    push('hard fails', [...hard].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(', ') || 'none');
    push('scenario misses', scen.filter(([, s]) => s.pass / s.total < 0.8).map(([id, s]) => `${id} ${s.pass}/${s.total}`).join(', ') || 'none');
  }

  const keys = Object.keys(rows);
  const w0 = Math.max(...keys.map(k => k.length));
  const clip = (v: string) => (v.length > 48 ? v.slice(0, 45) + '...' : v);
  const widths = [...cols.keys()].map((_, i) => Math.max(...keys.map(k => clip(rows[k][i]).length)));
  for (const k of keys) console.log(k.padEnd(w0) + '  ' + rows[k].map((v, i) => clip(v).padEnd(widths[i])).join('  '));
  void rideMeta;
}

main();
