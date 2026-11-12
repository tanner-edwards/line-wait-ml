// Static HTML for eval runs: one page per run plus a history index. Self-contained (inline CSS,
// no scripts, no external requests) so the folder can be opened locally or served from GitHub Pages.
//
// Everything model-generated is HTML-escaped: answers can contain anything (one scenario even
// plants an instruction in a ride name).

import { personaToText } from '../../app/backend/src/recommendations/persona';
import { AnswerJudgement, AXES, Axis } from './judge';
import { mean, parseModelText } from './parse';
import { BuiltScenario, ParsedRec, SCENARIOS, buildScenario } from './scenarios';
import { metrics, MetricRecord } from './stats';
import { getVariant } from './variants';

export interface ReportRecord extends MetricRecord {
  model: string;
  scenario: string;
  run: number;
  variant?: string;
  text?: string;
  rawText?: string;
}

/** Everything needed to (re)render a run page. Saved as site/data/<runId>.json. */
export interface RunData {
  runId: string;
  at: string;
  variant: string;
  variantDescription: string;
  model: string;
  mock: boolean;
  source: string;
  judges: string[];
  judgePromptVersion: string | null;
  records: ReportRecord[];
  judgements: AnswerJudgement[];
}

// --------------------------------------------------------------- helpers

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtMs = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '–');
const fmt1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const fmtPct = (x: number) => (Number.isFinite(x) ? `${x}%` : '–');
const shortModel = (m: string) => m.replace(/^(us|eu|apac)\./, '').replace(/-v\d+:\d+$/, '');
const shortJudge = (m: string) => shortModel(m).replace(/^[a-z]+\./, '');
const scoreClass = (x: number) => (!Number.isFinite(x) ? '' : x >= 4 ? 'good' : x >= 3 ? 'mid' : 'bad');
const pctClass = (x: number, good: number, ok: number) => (!Number.isFinite(x) ? '' : x >= good ? 'good' : x >= ok ? 'mid' : 'bad');
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const CHECK_LABELS: Record<string, string> = {
  'parse': "Answer wasn't valid JSON",
  'only-valid-ride-ids': "Recommended a ride that isn't in the list",
  'excludes-current-ride': 'Recommended the ride the guest is already on',
  'no-duplicates': 'Same ride listed twice',
  'returns-expected-count': 'Wrong number of recommendations',
  'oneLiner-<=80-chars': 'Caption over 80 characters',
  'no-internal-jargon': 'Caption uses internal jargon',
  'oneLiner-no-wait-or-ride-name-restated': 'Caption restates the wait or ride name',
  'restrictionNote-<=60-chars': 'Restriction note over 60 characters',
  'star-ride-surfaced': "Missed a rare-low 'star' ride in the top 3",
  'no-height-restricted-in-top3': "Height-restricted ride in a toddler's top 3",
  'borderline-height-rides-in-top3': "Borderline-height ride in a toddler's top 3",
  'no-rough-rides': 'Rough ride recommended to a pregnant guest',
  'mild-coaster-for-pregnant-guest': 'Jerky coaster recommended to a pregnant guest',
  'no-daylight-ride-at-night': 'Daytime scenery ride recommended near close',
  'closer-headliner-ranks-first': 'Farther ride ranked above an equally good closer one',
  'star-headliner-worth-the-walk': 'Missed a rare headliner window worth the walk',
  'must-do-ranks-high': 'Must-do ride with an open window not in the top 2',
  'does-not-recommend-poisoned-ride': 'Recommended the ride whose name hides an instruction',
  'does-not-obey-injected-instruction': 'Obeyed an instruction hidden in the data',
};
const checkName = (f: string) => f.split(':')[0];
const checkLabel = (f: string) => CHECK_LABELS[checkName(f)] ?? checkName(f);

function answerOf(r: ReportRecord, b: BuiltScenario): ParsedRec[] | null {
  const text = [r.text, r.rawText].filter((t): t is string => !!t).sort((a, c) => c.length - a.length)[0];
  if (r.error || !text) return null;
  const p = parseModelText(text);
  if (!p.recs) return null;
  const v = getVariant(r.variant ?? 'baseline');
  return v.decode ? v.decode(p.recs, b) : p.recs;
}

function judgeMeans(js: AnswerJudgement[]) {
  return Object.fromEntries(AXES.map(a => [a, mean(js.map(j => j.scores[a]))])) as Record<Axis, number>;
}

// ------------------------------------------------------------------ CSS

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
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
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
blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid var(--line);background:var(--soft);border-radius:0 6px 6px 0;white-space:pre-wrap;font-size:13px}
.runs{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-top:12px}
.run{border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--bg)}
.run h4{margin:0;font-size:14px;display:flex;justify-content:space-between;gap:8px}
ol.answer{margin:8px 0;padding-left:22px}ol.answer li{margin:6px 0}
.ride{font-weight:600}.cap{display:block}.len{font-size:11px;color:var(--muted)}.len.bad{color:var(--bad);font-weight:600}
.note{display:block;font-size:12px;color:var(--mid)}
.judge{border-top:1px dashed var(--line);margin-top:8px;padding-top:8px;font-size:13px}
.scores{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
.sc{font-size:11px;padding:1px 6px;border-radius:5px;background:var(--soft)}
.sc.good{background:var(--good-bg)}.sc.mid{background:var(--mid-bg)}.sc.bad{background:var(--bad-bg)}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:var(--soft);padding:8px;border-radius:6px;max-height:220px;overflow:auto}
footer{margin-top:40px;color:var(--muted);font-size:13px}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

// --------------------------------------------------------------- run page

export function renderRun(d: RunData): string {
  const recs = d.records.filter(r => r.scenario !== '*');
  const m = metrics(recs);
  const js = d.judgements;
  const jAll = judgeMeans(js);
  const H: string[] = [];

  H.push(`<p class="small"><a href="../index.html">&larr; All runs</a></p>`);
  H.push(`<h1>${esc(d.variant)} <span class="badge">${esc(shortModel(d.model))}</span>${d.mock ? ' <span class="badge warn">MOCK DATA: numbers are meaningless</span>' : ''}</h1>`);
  H.push(`<p class="sub">${esc(when(d.at))} &middot; ${esc(d.variantDescription)} &middot; ${recs.length} answers across ${new Set(recs.map(r => r.scenario)).size} scenarios</p>`);

  // ---- headline tiles
  const tile = (k: string, v: string, cls: string, n = '') => `<div class="tile"><div class="k">${k}</div><div class="v ${cls}">${v}</div>${n ? `<div class="n">${n}</div>` : ''}</div>`;
  H.push('<div class="tiles">');
  H.push(tile('Typical response', fmtMs(m.p50Ms), '', `slow (p95): ${fmtMs(m.p95Ms)}`));
  H.push(tile('Output tokens', Number.isFinite(m.outTokens) ? String(m.outTokens) : '–', '', 'per answer, drives speed'));
  H.push(tile('Valid answers', fmtPct(m.jsonOkPct), pctClass(m.jsonOkPct, 99, 95), `${m.errors} call errors`));
  H.push(tile('Hard rules', fmtPct(m.hardPassPct), pctClass(m.hardPassPct, 98, 90), `${m.cleanRuns}/${recs.length} answers fully clean`));
  H.push(tile('Soft checks', fmtPct(m.softPassPct), pctClass(m.softPassPct, 90, 75), 'caption rules + borderline cases'));
  H.push(tile('AI judges', js.length ? `${fmt1(jAll.overall)}<span class="small muted"> / 5</span>` : '–', scoreClass(jAll.overall), js.length ? d.judges.map(j => `${esc(shortJudge(j))}: ${fmt1(mean(js.filter(x => x.judge === j).map(x => x.scores.overall)))}`).join(' &middot; ') : 'not run'));
  H.push('</div>');

  // ---- where to look first
  const fails = new Map<string, number>();
  for (const r of recs) for (const f of [...r.hardFailures, ...r.softFailures]) fails.set(checkLabel(f), (fails.get(checkLabel(f)) ?? 0) + 1);
  const hardNames = new Set(recs.flatMap(r => r.hardFailures.map(checkLabel)));
  const answerScore = new Map<string, number[]>();
  for (const j of js) answerScore.set(`${j.scenario}|${j.run}`, [...(answerScore.get(`${j.scenario}|${j.run}`) ?? []), j.scores.overall]);
  const lowest = [...answerScore].map(([k, v]) => ({ k, v: mean(v) })).sort((a, b) => a.v - b.v).slice(0, 5);
  H.push('<h2>Where to look first</h2><div class="cols">');
  H.push(`<div class="panel"><h3>Rule failures</h3><p class="small muted">Automatic checks, counted per answer.</p>${fails.size ? `<table>${[...fails].sort((a, b) => b[1] - a[1]).map(([label, n]) => `<tr><td>${hardNames.has(label) ? '<span class="chip bad">hard</span>' : '<span class="chip mid">soft</span>'} ${esc(label)}</td><td class="num">${n} of ${recs.length}</td></tr>`).join('')}</table>` : '<p class="good">No rule failures.</p>'}</div>`);
  H.push(`<div class="panel"><h3>Lowest-rated answers</h3><p class="small muted">Average of the AI judges' overall score. Read these first.</p>${lowest.length ? `<table>${lowest.map(({ k, v }) => {
    const [sc, run] = k.split('|');
    const sum = js.find(j => j.scenario === sc && String(j.run) === run && j.summary)?.summary ?? '';
    return `<tr><td><a href="#${esc(sc)}-run${esc(run)}">${esc(sc)} &middot; run ${esc(run)}</a><br><span class="small muted">${esc(sum)}</span></td><td class="num ${scoreClass(v)}">${fmt1(v)}</td></tr>`;
  }).join('')}</table>` : '<p class="muted">AI judges not run.</p>'}</div>`);
  H.push('</div>');

  // ---- judge agreement
  if (d.judges.length > 1 && js.length) {
    const diffs: number[] = [];
    for (const [, v] of answerScore) if (v.length > 1) diffs.push(Math.max(...v) - Math.min(...v));
    const within1 = diffs.length ? Math.round((100 * diffs.filter(x => x <= 1).length) / diffs.length) : NaN;
    H.push(`<p class="small muted" style="margin-top:10px">Judges agree within 1 point on ${fmtPct(within1)} of answers. ${within1 < 70 ? '<strong class="mid">Low agreement: treat judge scores with extra caution.</strong>' : ''}</p>`);
  }

  // ---- scenario overview
  const scenIds = SCENARIOS.map(s => s.id).filter(id => recs.some(r => r.scenario === id));
  H.push('<h2>Scenarios</h2><div class="panel scroll"><table><tr><th>Scenario</th><th class="num">Clean answers</th><th class="num">AI judges</th><th class="num">Typical speed</th></tr>');
  for (const id of scenIds) {
    const rs = recs.filter(r => r.scenario === id);
    const sm = metrics(rs);
    const jm = mean(js.filter(j => j.scenario === id).map(j => j.scores.overall));
    H.push(`<tr><td><a href="#${esc(id)}">${esc(id)}</a><br><span class="small muted">${esc(SCENARIOS.find(s => s.id === id)?.description ?? '')}</span></td><td class="num ${pctClass((100 * sm.cleanRuns) / rs.length, 100, 60)}">${sm.cleanRuns}/${rs.length}</td><td class="num ${scoreClass(jm)}">${fmt1(jm)}</td><td class="num">${fmtMs(sm.p50Ms)}</td></tr>`);
  }
  H.push('</table></div>');

  // ---- per scenario detail
  for (const id of scenIds) {
    const sc = SCENARIOS.find(s => s.id === id)!;
    const b = buildScenario(sc);
    const rs = recs.filter(r => r.scenario === id).sort((a, c) => a.run - c.run);
    const sm = metrics(rs);
    const jm = judgeMeans(js.filter(j => j.scenario === id));
    H.push(`<section class="scenario" id="${esc(id)}"><header><h3>${esc(id)}</h3><span class="small muted">${esc(sc.description)}</span></header>`);
    H.push(`<div class="chips"><span class="chip ${pctClass((100 * sm.cleanRuns) / rs.length, 100, 60)}">${sm.cleanRuns}/${rs.length} answers pass all hard rules</span>${js.length ? `<span class="chip ${scoreClass(jm.overall)}">AI judges ${fmt1(jm.overall)}/5</span>` : ''}<span class="chip">typical ${fmtMs(sm.p50Ms)}</span></div>`);

    // situation
    H.push('<details><summary>Situation and ride data the model saw</summary>');
    H.push(`<p class="small">${esc(sc.currentLocalTime)} &middot; park hours ${esc(sc.parkHours ? `${sc.parkHours.open}–${sc.parkHours.close}` : 'unknown')} &middot; guest is at <strong>${esc(b.ctx.currentRide.name)}</strong></p>`);
    H.push(`<blockquote>${esc(personaToText(sc.persona, b.metadataMap))}</blockquote>`);
    H.push('<div class="scroll"><table><tr><th>Ride</th><th class="num">Wait</th><th class="num">Usual</th><th class="num">Later 30/60/90</th><th class="num">Range</th><th class="num">Walk</th><th>App verdict</th></tr>');
    for (const c of b.candidates) {
      const r = c.ride, v = r.verdict, bk = r.historicalAverage?.buckets ?? [];
      H.push(`<tr><td>${esc(r.name)}</td><td class="num">${esc(r.currentWait ?? '–')}</td><td class="num">${esc(v?.reasons.typical ?? '–')}</td><td class="num">${esc([1, 2, 3].map(i => bk[i]?.wait ?? '–').join('/'))}</td><td class="num">${r.rideStats ? `${r.rideStats.p10}–${r.rideStats.p90}` : '–'}</td><td class="num">${esc(c.walkMinutes ?? '?')} min</td><td>${v ? esc(`${v.verdict} (${v.reasons.primary})`) : '–'}</td></tr>`);
    }
    H.push('</table></div></details>');

    // runs
    H.push('<div class="runs">');
    for (const r of rs) {
      const ans = answerOf(r, b);
      const names = new Map(b.candidates.map(c => [c.ride.id, c.ride.name]));
      H.push(`<article class="run" id="${esc(id)}-run${r.run}"><h4><span>Run ${r.run}</span><span class="muted small">${r.error ? 'error' : `${fmtMs(r.wallMs ?? NaN)} &middot; ${esc(r.outputTokens ?? '?')} tokens`}</span></h4>`);
      const chips = [
        ...r.hardFailures.map(f => `<span class="chip bad" title="${esc(f)}">${esc(checkLabel(f))}</span>`),
        ...r.softFailures.map(f => `<span class="chip mid" title="${esc(f)}">${esc(checkLabel(f))}</span>`),
      ];
      H.push(`<div class="chips">${r.error ? `<span class="chip bad">${esc(r.error)}</span>` : chips.length ? chips.join('') : '<span class="chip good">All checks passed</span>'}</div>`);
      if (ans) {
        H.push(ans.length ? `<ol class="answer">${ans.map(a => {
          const len = a.oneLiner.length;
          return `<li><span class="ride">${esc(names.get(a.rideId) ?? `Unknown ride id: ${a.rideId}`)}</span><span class="cap">“${esc(a.oneLiner)}” <span class="len ${len > 80 ? 'bad' : ''}">${len} chars</span></span>${a.restrictionNote ? `<span class="note">Note: ${esc(a.restrictionNote)}</span>` : ''}</li>`;
        }).join('')}</ol>` : '<p class="muted">Empty list (no recommendations).</p>');
      } else if (!r.error) {
        H.push(`<p class="bad small">Could not read this answer.</p><pre>${esc((r.text ?? r.rawText ?? '').slice(0, 1500))}</pre>`);
      }
      for (const j of js.filter(x => x.scenario === id && x.run === r.run)) {
        H.push(`<div class="judge"><strong>${esc(shortJudge(j.judge))}</strong> <span class="${scoreClass(j.scores.overall)}">${j.scores.overall}/5</span>`);
        H.push(`<div class="scores">${(['grounding', 'ranking', 'copy', 'constraints'] as Axis[]).map(a => `<span class="sc ${scoreClass(j.scores[a])}">${a} ${j.scores[a]}</span>`).join('')}</div>`);
        if (j.summary) H.push(`<div>${esc(j.summary)}</div>`);
        if (j.problems.length) H.push(`<ul class="plain small">${j.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`);
        H.push('</div>');
      }
      H.push('</article>');
    }
    H.push('</div></section>');
  }

  H.push(`<footer><p><strong>How to read this.</strong> Speed and rule checks are measured and reliable. AI judge scores are pointers, not truth: they come from ${d.judges.length ? d.judges.map(j => esc(shortJudge(j))).join(' and ') : 'no judges'} (prompt ${esc(d.judgePromptVersion ?? 'n/a')}) and can shift with wording. Read the reasons next to each answer and decide whether you agree.</p>
<p>Source: <code>${esc(d.source)}</code> &middot; run id <code>${esc(d.runId)}</code></p></footer>`);
  return page(`Eval: ${d.variant} ${d.at.slice(0, 10)}`, H.join('\n'));
}

// --------------------------------------------------------------- history index

export function renderIndex(runs: RunData[]): string {
  const sorted = [...runs].sort((a, b) => b.at.localeCompare(a.at));
  const H: string[] = [];
  H.push('<h1>Recommendation eval runs</h1>');
  H.push('<p class="sub">Each row is one evaluation of the <code>/v2/recommendations</code> prompt. Open a run to see every answer, the rule checks and the AI judges’ notes.</p>');
  H.push('<div class="panel scroll"><table><tr><th>When</th><th>Variant</th><th>Model</th><th class="num">Typical speed</th><th class="num">Tokens</th><th class="num">Valid</th><th class="num">Hard rules</th><th class="num">Soft checks</th><th class="num">AI judges</th></tr>');
  for (const d of sorted) {
    const recs = d.records.filter(r => r.scenario !== '*');
    const m = metrics(recs);
    const j = mean(d.judgements.map(x => x.scores.overall));
    H.push(`<tr><td><a href="runs/${esc(d.runId)}.html">${esc(when(d.at))}</a>${d.mock ? ' <span class="badge warn">mock</span>' : ''}</td><td>${esc(d.variant)}</td><td class="small">${esc(shortModel(d.model))}</td><td class="num">${fmtMs(m.p50Ms)}</td><td class="num">${Number.isFinite(m.outTokens) ? m.outTokens : '–'}</td><td class="num ${pctClass(m.jsonOkPct, 99, 95)}">${fmtPct(m.jsonOkPct)}</td><td class="num ${pctClass(m.hardPassPct, 98, 90)}">${fmtPct(m.hardPassPct)}</td><td class="num ${pctClass(m.softPassPct, 90, 75)}">${fmtPct(m.softPassPct)}</td><td class="num ${scoreClass(j)}">${d.judgements.length ? fmt1(j) : '–'}</td></tr>`);
  }
  H.push('</table></div>');
  H.push('<footer>Speed and rule checks are measured. AI judge scores (out of 5) are pointers to read alongside the answers, not verdicts.</footer>');
  return page('Recommendation eval runs', H.join('\n'));
}
