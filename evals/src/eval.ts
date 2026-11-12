// One command: run the eval and produce a readable HTML report.
//
//   npm run eval                                  # baseline prompt, 3 runs, AI judges, HTML report
//   npm run eval -- --runs 5 --variant baseline
//   npm run eval -- --from baseline               # reuse the latest saved answers (no Haiku calls), judge + report
//   npm run eval -- --from results/x.json --no-judge
//   npm run eval -- --mock                        # offline, free, fake answers (to try the tool)
//   npm run eval -- --rebuild-site                # re-render every saved run page + the index
//
// Output: evals/site/index.html (history of runs) and evals/site/runs/<run>.html (one run).
// Options: --judges a,b (default config/judges.json) | --judge-runs n (judge only the first n runs
//   per scenario) | --no-judge | --no-open | --site-dir <dir> | plus every bench option
//   (--scenarios, --models, --temperature, ...).

import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { arg, EVALS_ROOT, flag, resolveRun, stamp } from './args';
import { generate, rescoreOne, RunRecord, VARIANT } from './bench';
import { RunData, renderIndex, renderRun } from './html';
import { AnswerJudgement, judgeAnswer, JUDGE_PROMPT_VERSION, pool } from './judge';
import { MOCK } from './llm';
import { mean, parseModelText } from './parse';
import { SCENARIOS, buildScenario } from './scenarios';
import { metrics } from './stats';
import { getVariant } from './variants';

const SITE = arg('site-dir', join(EVALS_ROOT, 'site'))!;

function loadSiteData(): RunData[] {
  const dir = join(SITE, 'data');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RunData);
}

function writeSite(runs: RunData[], all: RunData[]) {
  mkdirSync(join(SITE, 'data'), { recursive: true });
  mkdirSync(join(SITE, 'runs'), { recursive: true });
  for (const d of runs) {
    writeFileSync(join(SITE, 'data', `${d.runId}.json`), JSON.stringify(d));
    writeFileSync(join(SITE, 'runs', `${d.runId}.html`), renderRun(d));
  }
  writeFileSync(join(SITE, 'index.html'), renderIndex(all));
}

async function judgeRecords(records: RunRecord[], judges: string[]): Promise<AnswerJudgement[]> {
  const maxRuns = arg('judge-runs') ? Number(arg('judge-runs')) : Infinity;
  const tasks: (() => Promise<AnswerJudgement | null>)[] = [];
  for (const sc of SCENARIOS) {
    const b = buildScenario(sc);
    for (const r of records.filter(x => x.scenario === sc.id && x.run <= maxRuns && !x.error)) {
      const text = [r.text, r.rawText].filter((t): t is string => !!t).sort((a, c) => c.length - a.length)[0];
      const p = text ? parseModelText(text) : null;
      if (!p?.recs) continue;
      const v = getVariant(r.variant ?? 'baseline');
      const recs = v.decode ? v.decode(p.recs, b) : p.recs;
      for (const j of judges) tasks.push(() => judgeAnswer(j, b, recs, r.run));
    }
  }
  if (!tasks.length) return [];
  process.stdout.write(`AI judges: ${tasks.length} reviews (${judges.map(j => j.split('.').slice(-1)[0]).join(', ')}) `);
  const res = await pool(tasks, 4, n => { if (n % 10 === 0 || n === tasks.length) process.stdout.write('.'); });
  const ok = res.filter((x): x is AnswerJudgement => x !== null);
  console.log(` done${ok.length < res.length ? ` (${res.length - ok.length} unusable replies)` : ''}`);
  return ok;
}

async function main() {
  if (flag('rebuild-site')) {
    const all = loadSiteData();
    writeSite(all, all);
    console.log(`Rebuilt ${all.length} run page(s) and ${join(SITE, 'index.html')}`);
    return;
  }

  // 1. answers: reuse a saved run, or generate new ones
  let records: RunRecord[];
  let source: string;
  if (arg('from')) {
    source = resolveRun(arg('from')!);
    records = (JSON.parse(readFileSync(source, 'utf8')) as { records: RunRecord[] }).records;
    console.log(`Using saved answers from ${source} (no new model calls)`);
  } else {
    console.log(`Running variant "${VARIANT.id}"${MOCK ? ' [MOCK]' : ''}...`);
    const g = await generate();
    records = g.records;
    source = g.file;
  }
  // 2. always grade with the CURRENT checks, so old runs and new runs are comparable
  records = records.filter(r => r.scenario !== '*').map(rescoreOne);

  // 3. AI judges
  const judges = flag('no-judge') ? [] : (arg('judges') ?? (JSON.parse(readFileSync(join(EVALS_ROOT, 'config', 'judges.json'), 'utf8')) as { judges: string[] }).judges.join(',')).split(',').map(s => s.trim()).filter(Boolean);

  // 4. one report per model in the run
  const made: RunData[] = [];
  for (const model of [...new Set(records.map(r => r.model))]) {
    const rs = records.filter(r => r.model === model);
    const variantId = rs[0]?.variant ?? 'baseline';
    const judgements = judges.length ? await judgeRecords(rs, judges) : [];
    made.push({
      runId: `${stamp()}-${variantId}${records.some(r => r.model !== model) ? '-' + model.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) : ''}`,
      at: new Date().toISOString(),
      variant: variantId,
      variantDescription: getVariant(variantId).description,
      model,
      mock: MOCK || rs.some(r => /Mock tip/.test(r.text ?? '')),
      source,
      judges,
      judgePromptVersion: judges.length ? JUDGE_PROMPT_VERSION : null,
      records: rs.map(({ judge: _j, ...r }) => r),
      judgements,
    });
  }
  const all = [...loadSiteData().filter(d => !made.some(m => m.runId === d.runId)), ...made];
  writeSite(made, all);

  // 5. short summary + open
  for (const d of made) {
    const m = metrics(d.records);
    const j = mean(d.judgements.map(x => x.scores.overall));
    console.log(`\n${d.variant} on ${d.model}${d.mock ? ' [MOCK]' : ''}`);
    console.log(`  typical ${(m.p50Ms / 1000).toFixed(1)}s | ${m.outTokens} tokens | hard rules ${m.hardPassPct}% | soft checks ${m.softPassPct}% | AI judges ${d.judgements.length ? j.toFixed(1) + '/5' : 'off'}`);
    console.log(`  Report: ${join(SITE, 'runs', `${d.runId}.html`)}`);
  }
  console.log(`  All runs: ${join(SITE, 'index.html')}`);
  if (process.platform === 'darwin' && process.stdout.isTTY && !flag('no-open') && made[0]) {
    spawn('open', [join(SITE, 'runs', `${made[0].runId}.html`)], { stdio: 'ignore', detached: true }).unref();
  }
}

main().catch(err => { console.error('FAILED:', err.message ?? err); process.exit(1); });
