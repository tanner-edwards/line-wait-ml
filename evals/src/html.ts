// Static HTML for eval runs: one page per run plus a history index. Self-contained (inline CSS, no
// scripts, no external requests), so the folder opens locally or serves from GitHub Pages.
// Model output is always HTML-escaped (one scenario plants an instruction in a ride name).

import { buildFixture } from './fixtures/derive';
import { fixtureById } from './fixtures/scenarios';
import { grade, Graded } from './grade';
import { variety, VarietyMetrics } from './variety';
import { CRITERIA, CriterionId, describeParty, Judgement } from './judge';
import { pct } from './parse';
import { BuiltFixture, RunRecord } from './types';

export interface RunData {
  runId: string;
  at: string;
  variant: string;
  variantDescription: string;
  model: string;
  mock: boolean;
  source: string;
  judges: string[];
  judgeVersion: string | null;
  records: RunRecord[];
  judgements: Judgement[];
}

// ---------------------------------------------------------------- helpers

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtS = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '–');
const pctStr = (x: number) => (Number.isFinite(x) ? `${Math.round(x)}%` : '–');
const shortModel = (m: string) => m.replace(/^(us|eu|apac)\./, '').replace(/-v\d+:\d+$/, '');
const shortJudge = (m: string) => shortModel(m).replace(/^[a-z]+\./, '');
const cls = (x: number, good: number, ok: number) => (!Number.isFinite(x) ? '' : x >= good ? 'good' : x >= ok ? 'mid' : 'bad');
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const median = (xs: number[]) => (xs.length ? pct([...xs].sort((a, b) => a - b), 50) : NaN);
const PROVISIONAL = new Set(['S7', 'S7v']); // reopen threshold still being tuned (spec 6.6)
/** Spec §13.3: a scenario passes when at least 4 of 5 runs pass. */
const barFor = (n: number) => Math.max(1, Math.ceil(n * 0.8));

interface Analysis {
  graded: Graded[];
  built: Map<string, BuiltFixture>;
  fixtures: string[];
  metrics: { p50: number; p95: number; tokens: number; validPct: number; runPassPct: number; atBar: number; errors: number };
  judgePct: number;
  variety: VarietyMetrics;
}

export function analyse(d: RunData): Analysis {
  const built = new Map<string, BuiltFixture>();
  const graded = d.records.map(r => {
    if (!built.has(r.fixture)) built.set(r.fixture, buildFixture(fixtureById(r.fixture)));
    return grade(r, built.get(r.fixture)!);
  });
  const fixtures = [...new Set(d.records.map(r => r.fixture))];
  const ok = d.records.filter(r => !r.error);
  const lat = ok.map(r => r.wallMs).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  const atBar = fixtures.filter(f => { const g = graded.filter(x => x.rec.fixture === f); return g.filter(x => x.passed).length >= barFor(g.length); }).length;
  const jr = d.judgements.flatMap(j => Object.values(j.results)).filter(r => r && r.pass !== null);
  return {
    graded, built, fixtures,
    metrics: {
      p50: lat.length ? pct(lat, 50) : NaN, p95: lat.length ? pct(lat, 95) : NaN,
      tokens: median(ok.map(r => r.outputTokens).filter((x): x is number => typeof x === 'number')),
      validPct: graded.length ? (100 * graded.filter(g => g.recs).length) / graded.length : NaN,
      runPassPct: graded.length ? (100 * graded.filter(g => g.passed).length) / graded.length : NaN,
      atBar, errors: d.records.length - ok.length,
    },
    judgePct: jr.length ? (100 * jr.filter(r => r!.pass).length) / jr.length : NaN,
    variety: variety(graded.filter(g => g.recs).map(g => g.recs!.map(r => r.oneLiner))),
  };
}

// ---------------------------------------------------------------- CSS

const CSS = `
:root{--bg:#f7f7f5;--panel:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e3e2dc;--soft:#f0efea;
--good:#1f7a4d;--good-bg:#e3f3ea;--mid:#8a5a00;--mid-bg:#fbf0d9;--bad:#b42318;--bad-bg:#fbe4e1;--accent:#2f5bd3;}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141413;--panel:#1d1d1b;--ink:#ecebe6;--muted:#a3a29c;--line:#34332f;--soft:#26251f;
--good:#6fd39f;--good-bg:#173627;--mid:#f0c060;--mid-bg:#3a2e12;--bad:#ff8a7a;--bad-bg:#3d1b17;--accent:#8fb0ff;}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
a{color:var(--accent)}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 12px}h3{font-size:16px;margin:0}
.sub{color:var(--muted);margin:0 0 20px}.muted{color:var(--muted)}.small{font-size:13px}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;background:var(--soft);color:var(--muted);vertical-align:middle}
.badge.warn{background:var(--mid-bg);color:var(--mid)}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tile .k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.tile .v{font-size:24px;font-weight:700;margin-top:2px}.tile .n{font-size:12px;color:var(--muted)}
.good{color:var(--good)}.mid{color:var(--mid)}.bad{color:var(--bad)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
td.num,th.num{text-align:right;white-space:nowrap}
ul.plain{margin:0;padding-left:18px}ul.plain li{margin:3px 0}
.scenario{margin-top:16px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.scenario>header{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.chip{font-size:12px;padding:2px 8px;border-radius:6px;background:var(--soft);color:var(--muted)}
.chip.good{background:var(--good-bg);color:var(--good)}.chip.mid{background:var(--mid-bg);color:var(--mid)}.chip.bad{background:var(--bad-bg);color:var(--bad)}
details{margin:10px 0}summary{cursor:pointer;color:var(--accent);font-size:14px}
.expect{margin:8px 0;padding:8px 12px;border-left:3px solid var(--accent);background:var(--soft);border-radius:0 6px 6px 0;font-size:14px}
.runs{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-top:12px}
.run{border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--bg)}
.run.failed{border-color:var(--bad)}
.run h4{margin:0;font-size:14px;display:flex;justify-content:space-between;gap:8px}
ol.answer{margin:8px 0;padding-left:22px}ol.answer li{margin:6px 0}
.ride{font-weight:600}.cap{display:block}.len{font-size:11px;color:var(--muted)}.len.bad{color:var(--bad);font-weight:600}
.note{display:block;font-size:12px;color:var(--mid)}
.checks{list-style:none;margin:6px 0;padding:0;font-size:13px}.checks li{margin:2px 0}
.judge{border-top:1px dashed var(--line);margin-top:8px;padding-top:8px;font-size:13px}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:var(--soft);padding:8px;border-radius:6px;max-height:220px;overflow:auto}
footer{margin-top:40px;color:var(--muted);font-size:13px}
`;

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;

const mark = (p: boolean | null) => (p === null ? '<span class="muted">–</span>' : p ? '<span class="good">✓</span>' : '<span class="bad">✗</span>');

// ---------------------------------------------------------------- run page

export function renderRun(d: RunData): string {
  const a = analyse(d);
  const m = a.metrics;
  const H: string[] = [];
  const n = (f: string) => a.graded.filter(g => g.rec.fixture === f);

  H.push('<p class="small"><a href="../index.html">&larr; All runs</a></p>');
  H.push(`<h1>${esc(d.variant)} <span class="badge">${esc(shortModel(d.model))}</span>${d.mock ? ' <span class="badge warn">MOCK DATA: numbers are meaningless</span>' : ''}</h1>`);
  H.push(`<p class="sub">${esc(when(d.at))} &middot; ${esc(d.variantDescription)} &middot; ${a.fixtures.length} scenarios &times; ${d.records.length / Math.max(1, a.fixtures.length)} runs</p>`);

  const tile = (k: string, v: string, c: string, note = '') => `<div class="tile"><div class="k">${k}</div><div class="v ${c}">${v}</div>${note ? `<div class="n">${note}</div>` : ''}</div>`;
  H.push('<div class="tiles">');
  H.push(tile('Scenarios passing', `${m.atBar}/${a.fixtures.length}`, cls((100 * m.atBar) / a.fixtures.length, 100, 70), 'at least 4 of 5 runs pass (spec target)'));
  H.push(tile('Runs passing', pctStr(m.runPassPct), cls(m.runPassPct, 90, 70), 'every hard check and scenario rule'));
  H.push(tile('Typical response', fmtS(m.p50), '', `slow (p95): ${fmtS(m.p95)}`));
  H.push(tile('Output tokens', Number.isFinite(m.tokens) ? String(Math.round(m.tokens)) : '–', '', 'median per answer'));
  H.push(tile('Valid answers', pctStr(m.validPct), cls(m.validPct, 99, 95), `${m.errors} call errors`));
  H.push(tile('AI judge', pctStr(a.judgePct), cls(a.judgePct, 90, 70), d.judges.length ? 'questions passed (pointer, not proof)' : 'not run'));
  H.push(tile('Variety', pctStr(100 * a.variety.distinctOpeners), cls(100 * a.variety.distinctOpeners, 80, 60), `distinct openers; ${pctStr(100 * a.variety.withinRepeat)} of captions repeat a phrase within their answer, ${pctStr(100 * a.variety.acrossRepeat)} reuse an opener across runs`));
  H.push('</div>');
  if (a.variety.topPhrases.length) H.push(`<p class="small"><strong>Most repeated phrases:</strong> ${a.variety.topPhrases.map(p => `${esc(p.phrase)} <span class="muted">(${p.count})</span>`).join(' &middot; ')}</p>`);

  // ---- scenarios
  H.push('<h2>Scenarios</h2><div class="panel scroll"><table><tr><th>Scenario</th><th class="num">Runs passing</th><th>Most common failures</th><th class="num">AI judge</th><th class="num">Tokens</th><th class="num">Speed</th></tr>');
  for (const f of a.fixtures) {
    const g = n(f);
    const passed = g.filter(x => x.passed).length;
    const fails = new Map<string, number>();
    for (const x of g) for (const c of x.checks) if (!c.pass && c.severity === 'hard') fails.set(c.label, (fails.get(c.label) ?? 0) + 1);
    const jr = d.judgements.filter(j => j.fixture === f).flatMap(j => Object.values(j.results)).filter(r => r && r.pass !== null);
    const recs = g.map(x => x.rec).filter(r => !r.error);
    const fx = a.built.get(f)!.fx;
    H.push(`<tr><td><a href="#${esc(f)}">${esc(f)}</a> ${esc(fx.title)}${PROVISIONAL.has(f) ? ' <span class="badge warn">threshold being tuned</span>' : ''}</td>
<td class="num ${passed >= barFor(g.length) ? 'good' : 'bad'}">${passed}/${g.length}</td>
<td class="small">${[...fails].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([l, k]) => `${esc(l)} <span class="muted">(${k})</span>`).join('<br>') || '<span class="muted">none</span>'}</td>
<td class="num">${jr.length ? pctStr((100 * jr.filter(r => r!.pass).length) / jr.length) : '–'}</td>
<td class="num">${Math.round(median(recs.map(r => r.outputTokens ?? NaN).filter(Number.isFinite))) || '–'}</td>
<td class="num">${fmtS(median(recs.map(r => r.wallMs ?? NaN).filter(Number.isFinite)))}</td></tr>`);
  }
  H.push('</table></div>');

  // ---- checks
  const byCheck = new Map<string, { label: string; kind: string; pass: number; total: number }>();
  for (const g of a.graded) for (const c of g.checks) {
    const k = byCheck.get(c.id) ?? { label: c.label, kind: c.scenario ? 'scenario' : c.severity, pass: 0, total: 0 };
    k.total++; if (c.pass) k.pass++;
    byCheck.set(c.id, k);
  }
  H.push('<h2>Checks</h2><p class="small muted">Code checks from the spec. "Hard" and "scenario" checks decide whether a run passes; "soft" ones are style targets.</p><div class="panel scroll"><table><tr><th>Check</th><th>Kind</th><th class="num">Pass rate</th></tr>');
  for (const [, k] of [...byCheck].sort((x, y) => x[1].pass / x[1].total - y[1].pass / y[1].total)) {
    const r = (100 * k.pass) / k.total;
    H.push(`<tr><td>${esc(k.label)}</td><td><span class="chip ${k.kind === 'soft' ? 'mid' : k.kind === 'scenario' ? '' : 'bad'}">${k.kind}</span></td><td class="num ${cls(r, 100, 80)}">${k.pass}/${k.total}</td></tr>`);
  }
  H.push('</table></div>');

  // ---- judge
  if (d.judges.length) {
    H.push('<h2>AI judge</h2><p class="small muted">Pass/fail questions that code cannot check. Validate the judges with <code>npm run judge-check</code> before relying on these.</p><div class="panel scroll"><table>');
    H.push(`<tr><th>Question</th>${d.judges.map(j => `<th class="num">${esc(shortJudge(j))}</th>`).join('')}</tr>`);
    for (const c of CRITERIA) {
      H.push(`<tr><td>${esc(c.label)}</td>${d.judges.map(j => {
        const rs = d.judgements.filter(x => x.judge === j).map(x => x.results[c.id as CriterionId]).filter(r => r && r.pass !== null);
        const r = rs.length ? (100 * rs.filter(x => x!.pass).length) / rs.length : NaN;
        return `<td class="num ${cls(r, 90, 70)}">${rs.length ? `${rs.filter(x => x!.pass).length}/${rs.length}` : '–'}</td>`;
      }).join('')}</tr>`);
    }
    H.push('</table></div>');
  }

  // ---- per scenario
  for (const f of a.fixtures) {
    const b = a.built.get(f)!;
    const g = n(f).sort((x, y) => x.rec.run - y.rec.run);
    const passed = g.filter(x => x.passed).length;
    H.push(`<section class="scenario" id="${esc(f)}"><header><h3>${esc(f)} &middot; ${esc(b.fx.title)}</h3><span class="chip ${passed >= barFor(g.length) ? 'good' : 'bad'}">${passed}/${g.length} runs pass</span></header>`);
    H.push(`<div class="expect"><strong>Spec expects:</strong> ${esc(b.fx.expectation)}</div>`);
    H.push(`<details><summary>Situation the model was given</summary><p class="small">${esc(b.fx.localTime)} &middot; closes ${esc(b.fx.hours?.close ?? 'unknown')} &middot; field: ${esc(b.field)} &middot; ${esc(describeParty(b))}</p>`);
    H.push('<div class="scroll"><table><tr><th>Ride</th><th class="num">Wait</th><th class="num">Usual</th><th>vs usual</th><th class="num">Walk</th><th>Verdict</th><th>Wanted</th><th>Restricted for</th><th>Notes</th></tr>');
    for (const r of b.rides) {
      const notes = [r.isAnchor ? 'guest is here' : '', r.minutesSinceReopen != null ? `reopened ${r.minutesSinceReopen} min ago` : '', r.window ? `best later: ${r.window.wait} in ${r.window.inMin} min` : '', `forecast ${r.buckets.slice(0, 4).join(', ')}`].filter(Boolean).join('; ');
      H.push(`<tr><td>${esc(r.name)}</td><td class="num">${r.wait}</td><td class="num">${r.usual ?? '–'}</td><td>${esc(r.ofUsual ?? '–')} (${r.vsUsual != null && r.vsUsual > 0 ? '+' : ''}${r.vsUsual ?? '–'})</td><td class="num">${r.walk}</td><td>${esc(r.verdict)}</td><td>${r.wanted ? 'yes' : ''}</td><td>${esc(r.restrictedFor.join(', '))}</td><td class="small">${esc(notes)}</td></tr>`);
    }
    H.push('</table></div>');
    H.push(`<p class="small muted">Values the spec did not state (please confirm): ${esc(b.fx.filled.join('; '))}</p></details>`);

    H.push('<div class="runs">');
    for (const x of g) {
      const r = x.rec;
      H.push(`<article class="run${x.passed ? '' : ' failed'}"><h4><span>Run ${r.run} ${x.passed ? '<span class="good">pass</span>' : '<span class="bad">fail</span>'}</span><span class="muted small">${r.error ? 'error' : `${fmtS(r.wallMs ?? NaN)} &middot; ${esc(r.outputTokens ?? '?')} tokens`}</span></h4>`);
      if (x.recs) {
        H.push(x.recs.length ? `<ol class="answer">${x.recs.map(e => {
          const w = words(e.oneLiner);
          return `<li><span class="ride">${esc(e.ride ?? `Unknown ride: ${e.rawId}`)}</span><span class="cap">“${esc(e.oneLiner)}” <span class="len ${w > 18 ? 'bad' : ''}">${w} words</span></span>${e.restrictionNote ? `<span class="note">Note: ${esc(e.restrictionNote)}</span>` : ''}</li>`;
        }).join('')}</ol>` : '<p class="muted">Empty list.</p>');
      } else if (!r.error) {
        H.push(`<p class="bad small">Could not read this answer.</p><pre>${esc((r.text ?? '').slice(0, 1500))}</pre>`);
      }
      const failed = x.checks.filter(c => !c.pass && !c.scenario); // scenario rules are listed below with ✓/✗
      H.push(`<div class="chips">${failed.length ? failed.map(c => `<span class="chip ${c.severity === 'soft' ? 'mid' : 'bad'}" title="${esc(c.detail ?? '')}">${esc(c.label)}</span>`).join('') : '<span class="chip good">All checks passed</span>'}</div>`);
      const sc = x.checks.filter(c => c.scenario);
      if (sc.length) H.push(`<ul class="checks">${sc.map(c => `<li>${mark(c.pass)} ${esc(c.label)}${c.pass ? '' : ` <span class="muted">(${esc(c.detail ?? '')})</span>`}</li>`).join('')}</ul>`);
      for (const j of d.judgements.filter(j => j.fixture === f && j.run === r.run)) {
        H.push(`<div class="judge"><strong>${esc(shortJudge(j.judge))}</strong><ul class="checks">${CRITERIA.map(c => {
          const res = j.results[c.id as CriterionId];
          return res ? `<li>${mark(res.pass)} ${esc(c.label)}${res.pass === false || res.why ? ` <span class="muted">${esc(res.why)}</span>` : ''}</li>` : '';
        }).join('')}</ul></div>`);
      }
      H.push('</article>');
    }
    H.push('</div></section>');
  }

  H.push(`<footer><p><strong>How to read this.</strong> A run passes when every hard code check and every scenario rule passes. The spec's bar is a scenario passing at least 4 of 5 runs. Speed, tokens and code checks are measured. AI judge results are pointers from ${d.judges.map(j => esc(shortJudge(j))).join(' and ') || 'no judges'} (rules ${esc(d.judgeVersion ?? 'n/a')}): read the reasons and decide whether you agree.</p>
<p>Source: <code>${esc(d.source)}</code> &middot; run id <code>${esc(d.runId)}</code></p></footer>`);
  return page(`Eval: ${d.variant} ${d.at.slice(0, 10)}`, H.join('\n'));
}

// ---------------------------------------------------------------- history index

export function renderIndex(runs: RunData[]): string {
  const H: string[] = ['<h1>Recommendation eval runs</h1>', '<p class="sub">Each row is one evaluation of a prompt version against the spec scenarios. Open a run for every answer, check and judge note.</p>'];
  H.push('<div class="panel scroll"><table><tr><th>When</th><th>Variant</th><th>Model</th><th class="num">Scenarios passing</th><th class="num">Runs passing</th><th class="num">Speed</th><th class="num">Tokens</th><th class="num">AI judge</th></tr>');
  for (const d of [...runs].sort((x, y) => y.at.localeCompare(x.at))) {
    const a = analyse(d);
    H.push(`<tr><td><a href="runs/${esc(d.runId)}.html">${esc(when(d.at))}</a>${d.mock ? ' <span class="badge warn">mock</span>' : ''}</td><td>${esc(d.variant)}</td><td class="small">${esc(shortModel(d.model))}</td>
<td class="num ${cls((100 * a.metrics.atBar) / a.fixtures.length, 100, 70)}">${a.metrics.atBar}/${a.fixtures.length}</td><td class="num">${pctStr(a.metrics.runPassPct)}</td><td class="num">${fmtS(a.metrics.p50)}</td><td class="num">${Number.isFinite(a.metrics.tokens) ? Math.round(a.metrics.tokens) : '–'}</td><td class="num">${pctStr(a.judgePct)}</td></tr>`);
  }
  H.push('</table></div><footer>Spec target: every scenario passes at least 4 of 5 runs, and output tokens drop at least 25% from v1. AI judge numbers are pointers, not proof.</footer>');
  return page('Recommendation eval runs', H.join('\n'));
}

