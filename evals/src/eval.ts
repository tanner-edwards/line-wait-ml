// One command: run the spec scenarios against a prompt variant, grade, judge, and write the HTML report.
//
//   npm run eval                              # v1 (current production prompt), 5 runs, AI judges, report
//   npm run eval -- --variant spec-codes      # a candidate (once added in src/variants.ts)
//   npm run eval -- --from v1                 # re-grade + re-judge the latest saved v1 run, no model calls
//   npm run eval -- --mock                    # offline, free, fake answers (to try the tool)
//   npm run eval -- --rebuild-site            # re-render every saved run with the current checks
//
// Options: --runs n (default 5, the spec's protocol) | --fixtures S1,S2 | --model <bedrock id>
//   --smoke [--live <park>]  five hard scenarios + live sample x 3 personas, 1 run, ~2 min
//   --concurrency n (default 3) answer calls in flight
//   --live <park> [--start hub] [--rides 8] [--seed n] [--personas default,toddler]  capture the park now, sample
//     random rides, run every persona preset against the same set (default 1 run; needs Firebase env)
//   --judges a,b (default config/judges.json) | --no-judge | --no-open | --site-dir <dir>

import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { arg, EVALS_ROOT, flag, PRODUCTION_MODEL, resolveRun, stamp } from './args';
import { buildFixture } from './fixtures/derive';
import { FIXTURES, fixtureById, SMOKE_SCENARIOS } from './fixtures/scenarios';
import { grade } from './grade';
import { RunData, renderIndex, renderRun } from './html';
import { isJudgement, JUDGE_VERSION, Judgement, JudgeFailure, judgeAnswer, pool } from './judge';
import { MOCK } from './llm';
import { generate } from './run';
import { RunRecord } from './types';
import { getVariant } from './variants';
import { captureLive, sampleLive, startSpot, writeLiveFixture } from './live';
import { presetsByKey } from './personas';
import { ParkSlug } from '../../app/backend/src/types';

const SITE = arg('site-dir', join(EVALS_ROOT, 'site'))!;

function loadSite(): RunData[] {
  const dir = join(SITE, 'data');
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RunData) : [];
}

function writeSite(made: RunData[], all: RunData[]) {
  mkdirSync(join(SITE, 'data'), { recursive: true });
  mkdirSync(join(SITE, 'runs'), { recursive: true });
  for (const d of made) {
    writeFileSync(join(SITE, 'data', `${d.runId}.json`), JSON.stringify(d));
    writeFileSync(join(SITE, 'runs', `${d.runId}.html`), renderRun(d));
  }
  writeFileSync(join(SITE, 'index.html'), renderIndex(all));
}

async function judgeAll(records: RunRecord[], judges: string[]): Promise<Judgement[]> {
  const tasks: (() => Promise<Judgement | JudgeFailure>)[] = [];
  for (const rec of records) {
    const b = buildFixture(fixtureById(rec.fixture));
    const g = grade(rec, b);
    if (!g.recs || !g.recs.length) continue;
    for (const j of judges) tasks.push(() => judgeAnswer(j, b, g.recs!, rec.run, rec.offered));
  }
  if (!tasks.length) return [];
  process.stdout.write(`AI judges: ${tasks.length} reviews `);
  const res = await pool(tasks, 4, k => { if (k % 10 === 0 || k === tasks.length) process.stdout.write('.'); });
  const ok = res.filter(isJudgement);
  const failed = res.filter((x): x is JudgeFailure => !isJudgement(x));
  console.log(` done${failed.length ? ` (${failed.length} unusable replies)` : ''}`);
  for (const [judge, msg] of new Map(failed.map(f => [f.judge, f.error]))) console.log(`  ${judge}: ${failed.filter(f => f.judge === judge).length} unusable, e.g. ${msg}`);
  return ok;
}

async function main() {
  const t0 = Date.now();
  if (flag('rebuild-site')) {
    const all = loadSite();
    writeSite(all, all);
    console.log(`Rebuilt ${all.length} run page(s) and ${join(SITE, 'index.html')}`);
    return;
  }

  // 1. answers
  let records: RunRecord[];
  let source: string;
  if (arg('from')) {
    source = resolveRun(arg('from')!);
    records = (JSON.parse(readFileSync(source, 'utf8')) as { records: RunRecord[] }).records;
    console.log(`Using saved answers from ${source} (no new model calls)`);
  } else {
    const variant = getVariant(arg('variant', 'v1')!);
    const smoke = flag('smoke');
    const wanted = arg('fixtures')?.split(',').map(s => s.trim());
    // --smoke: the five hard scenarios plus a live sample with three personas, one run each.
    // Directional in about two minutes; the full matrix is the decision.
    let fixtures = wanted ? wanted.map(fixtureById) : smoke ? SMOKE_SCENARIOS.map(fixtureById) : FIXTURES;
    const livePark = arg('live') ?? (smoke ? 'disneyland' : undefined);
    if (livePark) {
      // Live-random: capture the park now, sample --rides rides, one fixture per persona preset.
      const park = livePark as ParkSlug;
      const seed = Number(arg('seed', String(Date.now() % 1_000_000)));
      const presets = presetsByKey((arg('personas') ?? (smoke ? 'default,toddler,thrills' : ''))?.split(',').map(s => s.trim()).filter(Boolean));
      const startKey = arg('start', 'hub')!;
      const spot = startSpot(park, startKey);
      const captured = await captureLive(park, spot.lat, spot.lng);
      const base = { ...captured, start: startKey, filled: [...captured.filled, `Guest is standing at ${spot.label} (playbook spot "${startKey}").`] };
      const live = sampleLive(base, { rides: Number(arg('rides', '8')), seed, presets }).map(fx => ({ ...fx, asserts: [] }));
      for (const fx of live) writeLiveFixture(fx);
      fixtures = smoke ? [...fixtures, ...live] : live;
      const w = base.weather ? `, ${base.weather.tempF}F ${base.weather.conditions}` : '';
      console.log(`Live ${park} at ${base.localTime}${w}, from ${spot.label}: ${base.rides.length + 1} operating rides, anchor ${base.anchor.name}, closes ${base.hours?.close ?? 'unknown'}`);
      console.log(`Sampled ${live[0].rides.length} rides (seed ${seed}): ${live[0].rides.map(r => r.name).join(', ')}`);
      console.log(`Personas: ${presets.map(p => p.key).join(', ')}. Fixtures saved under evals/live/ as ${live[0].id.replace(/-[a-z-]+$/, '')}-<persona>.json`);
    }
    const runs = Number(arg('runs', livePark ? '1' : '5'));
    const model = arg('model', PRODUCTION_MODEL)!;
    console.log(`Running ${variant.id} on ${model}${MOCK ? ' [MOCK]' : ''}: ${fixtures.length} scenarios x ${runs} runs`);
    const g = await generate({ variant, fixtures, runs, model });
    records = g.records;
    source = g.file;
  }
  if (!records.length) throw new Error('No records to evaluate.');

  // 2. judges
  const judges = flag('no-judge') ? [] : (arg('judges') ?? (JSON.parse(readFileSync(join(EVALS_ROOT, 'config', 'judges.json'), 'utf8')) as { judges: string[] }).judges.join(','))
    .split(',').map(s => s.trim()).filter(Boolean);
  const judgements = judges.length ? await judgeAll(records, judges) : [];

  // 3. report
  const variantId = records[0].variant;
  const d: RunData = {
    runId: `${stamp()}-${variantId}`,
    at: new Date().toISOString(),
    variant: variantId,
    variantDescription: getVariant(variantId).description,
    model: records[0].model,
    mock: MOCK || records.some(r => /Mock tip/.test(r.text ?? '')),
    source, judges, judgeVersion: judges.length ? JUDGE_VERSION : null, records, judgements,
  };
  writeSite([d], [...loadSite().filter(x => x.runId !== d.runId), d]);

  // 4. summary
  const graded = records.map(r => grade(r, buildFixture(fixtureById(r.fixture))));
  const fixtures = [...new Set(records.map(r => r.fixture))];
  const atBar = fixtures.filter(f => { const g = graded.filter(x => x.rec.fixture === f); return g.filter(x => x.passed).length >= Math.max(1, Math.ceil(g.length * 0.8)); });
  const missed = fixtures.filter(f => !atBar.includes(f));
  const page = join(SITE, 'runs', `${d.runId}.html`);
  console.log(`\nElapsed ${Math.round((Date.now() - t0) / 1000)} s`);
  console.log(`\n${d.variant} on ${d.model}${d.mock ? ' [MOCK]' : ''}: ${atBar.length}/${fixtures.length} scenarios pass at least 4 of 5 runs${missed.length ? ` (missing: ${missed.join(', ')})` : ''}`);
  console.log(`Report: ${page}\nAll runs: ${join(SITE, 'index.html')}`);
  if (process.platform === 'darwin' && process.stdout.isTTY && !flag('no-open')) spawn('open', [page], { stdio: 'ignore', detached: true }).unref();
}

main().catch(err => { console.error('FAILED:', err.message ?? err); process.exit(1); });
