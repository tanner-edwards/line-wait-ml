// Runner: scenarios x runs for a prompt VARIANT on one or more Bedrock models.
//
// For each model x scenario x run it builds the prompt (via the selected variant), calls Bedrock,
// times the full round trip, parses the answer, and scores it against deterministic checks.
// Results are saved to results/<variant>-<timestamp>.json after every round.
//
// Usage (from evals/):
//   npm run bench -- --variant baseline --runs 5            # production model, current prompt
//   npm run bench -- --variant short-ids --runs 5           # an experiment
//   npm run bench -- --all-models --runs 3                  # every finalist in config/models.json
//   npm run bench -- --models id1,id2 --scenarios toddler-family,pregnant-guest
//   npm run dry-run                                         # no AWS calls; validates fixtures, checks, variants
//   npm run bench -- --mock --runs 2                        # whole pipeline offline with fake answers
//   npm run bench -- --rescore results/x.json               # re-grade saved answers with current checks
//   npm run bench -- --report results/x.json                # re-print a summary
// Then compare two runs head-to-head with judges:  npm run compare -- results/a.json results/b.json
//
// Flags: --temperature n | --max-tokens n | --timeout-ms n (per call, default 60000) |
//   --skip-if-slower-than ms (skip a model whose warm-up is slower) | --region r |
//   --bedrock-reasoning-effort low|medium|high (gpt-oss) | --latency-optimized (supported models only)
//
// Latency is wall-clock around the SDK call (what a Lambda waits), since the endpoint is
// non-streaming. Bedrock's server-side `metrics.latencyMs` is recorded alongside it.

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { personaToText } from '../../app/backend/src/recommendations/persona';
import { arg, flag, EVALS_ROOT, PRODUCTION_MODEL, stamp } from './args';
import { converse, REGION } from './llm';
import { mean, parseModelText, pct } from './parse';
import { getVariant, VARIANTS } from './variants';
import {
  BATCH_SIZE, BuiltScenario, GENERIC_CHECKS, ParsedRec, SCENARIOS, buildScenario,
} from './scenarios';

// ---------------------------------------------------------------- CLI args

export const RUNS = Number(arg('runs', '3'));
const MAX_TOKENS = Number(arg('max-tokens', '2000'));
const TEMPERATURE = arg('temperature') !== undefined ? Number(arg('temperature')) : undefined; // unset = same as production
const JUDGE = arg('judge'); // optional per-answer 1-5 grading by a Bedrock model (compare.ts is the better judge)
const SKIP_IF_SLOWER_MS = arg('skip-if-slower-than') ? Number(arg('skip-if-slower-than')) : null; // skip a model whose warm-up call exceeds this
export const VARIANT = getVariant(arg('variant', 'baseline')!);
const OUT = arg('out') ?? `${EVALS_ROOT}/results/${VARIANT.id}-${stamp()}.json`; // always saved
const DRY = flag('dry-run');

// Default = only the production model (the prompt-iteration workflow). --all-models runs the
// finalist list in config/models.json; --models a,b picks explicitly.
function loadModels(): string[] {
  const inline = arg('models');
  if (inline) return inline.split(',').map(s => s.trim()).filter(Boolean);
  if (flag('all-models')) {
    const file = arg('models-file', `${EVALS_ROOT}/config/models.json`)!;
    return (JSON.parse(readFileSync(file, 'utf8')) as { models: { id: string }[] }).models.map(m => m.id);
  }
  return [PRODUCTION_MODEL];
}

// ------------------------------------------------------------------ judging

const JUDGE_SYSTEM = `You grade a theme-park ride recommender. You get the guest persona, the ride data given to the model, and the model's ranked answer. Score 1-5 on each axis (5 = excellent):
- ranking: does the order serve THIS guest (persona, timing windows, walking distance tie-breaks) given the data?
- copy: are the one-liners helpful, friendly, specific, and free of restated numbers/internal jargon?
Respond with JSON only: {"ranking": n, "copy": n, "note": "<one short sentence>"}`;

async function judge(b: BuiltScenario, userMsg: string, answer: string): Promise<{ ranking: number; copy: number; note: string } | null> {
  if (!JUDGE) return null;
  try {
    const persona = personaToText(b.scenario.persona, b.metadataMap);
    const r = await converse(JUDGE, JUDGE_SYSTEM, `PERSONA:\n${persona}\n\nDATA GIVEN TO MODEL:\n${userMsg}\n\nMODEL ANSWER:\n${answer}`, { maxTokens: 300, temperature: 0 });
    const m = r.text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ one run

export interface RunRecord {
  model: string;
  scenario: string;
  run: number;
  error?: string;
  wallMs?: number;
  serverMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  parsed: boolean;
  fenced: boolean;
  hardFailures: string[];
  softFailures: string[];
  checksRun: { hard: number; soft: number };
  judge?: { ranking: number; copy: number; note: string } | null;
  variant?: string;
  rawText?: string;
  text?: string; // full model answer (spread in from the call result)
}

export function evaluate(b: BuiltScenario, recs: ParsedRec[]) {
  const hardFailures: string[] = [];
  const softFailures: string[] = [];
  let hard = 0, soft = 0;
  for (const c of [...GENERIC_CHECKS, ...b.scenario.checks]) {
    c.severity === 'hard' ? hard++ : soft++;
    const why = c.run(recs, b);
    if (why) (c.severity === 'hard' ? hardFailures : softFailures).push(`${c.name}: ${why}`);
  }
  return { hardFailures, softFailures, checksRun: { hard, soft } };
}

async function runOne(model: string, b: BuiltScenario, run: number): Promise<RunRecord> {
  const system = VARIANT.buildSystem(personaToText(b.scenario.persona, b.metadataMap), BATCH_SIZE);
  const user = VARIANT.buildUser(b.ctx, BATCH_SIZE);
  const base = { model, scenario: b.scenario.id, run, variant: VARIANT.id };
  try {
    const call = await converse(model, system, user, { maxTokens: MAX_TOKENS, temperature: TEMPERATURE });
    const parsedModel = parseModelText(call.text);
    const { fenced, error } = parsedModel;
    const recs = parsedModel.recs && VARIANT.decode ? VARIANT.decode(parsedModel.recs, b) : parsedModel.recs;
    if (!recs) {
      return { ...base, ...call, parsed: false, fenced, hardFailures: [`parse: ${error}`], softFailures: [], checksRun: { hard: 1, soft: 0 }, rawText: call.text.slice(0, 2000) };
    }
    const ev = evaluate(b, recs);
    return { ...base, ...call, parsed: true, fenced, ...ev, judge: await judge(b, user, call.text), rawText: call.text.slice(0, 6000) };
  } catch (err) {
    return { ...base, error: `${(err as Error).name}: ${(err as Error).message.slice(0, 120)}`, parsed: false, fenced: false, hardFailures: [], softFailures: [], checksRun: { hard: 0, soft: 0 } };
  }
}

// ------------------------------------------------------------------ report

function report(records: RunRecord[], models: string[]) {
  const rows = models.map(model => {
    const rs = records.filter(r => r.model === model);
    const ok = rs.filter(r => !r.error);
    const lat = ok.map(r => r.wallMs!).sort((a, b) => a - b);
    const outTok = ok.map(r => r.outputTokens).filter((x): x is number => x != null);
    const tps = ok.filter(r => r.outputTokens && r.wallMs).map(r => r.outputTokens! / (r.wallMs! / 1000));
    const hardRun = ok.reduce((n, r) => n + r.checksRun.hard, 0);
    const hardFail = ok.reduce((n, r) => n + r.hardFailures.length, 0);
    const softRun = ok.reduce((n, r) => n + r.checksRun.soft, 0);
    const softFail = ok.reduce((n, r) => n + r.softFailures.length, 0);
    const j = ok.map(r => r.judge).filter(Boolean) as { ranking: number; copy: number }[];
    return {
      model,
      calls: rs.length,
      errors: rs.length - ok.length,
      'p50 ms': Math.round(pct(lat, 50)),
      'p95 ms': Math.round(pct(lat, 95)),
      'mean ms': Math.round(mean(lat)),
      'out tok': Math.round(mean(outTok)),
      'tok/s': Math.round(mean(tps)),
      'json ok %': Math.round((100 * ok.filter(r => r.parsed).length) / Math.max(1, ok.length)),
      'hard pass %': hardRun ? Math.round((100 * (hardRun - hardFail)) / hardRun) : NaN,
      'soft pass %': softRun ? Math.round((100 * (softRun - softFail)) / softRun) : NaN,
      ...(JUDGE ? { 'judge rank': +mean(j.map(x => x.ranking)).toFixed(2), 'judge copy': +mean(j.map(x => x.copy)).toFixed(2) } : {}),
    };
  });
  console.log('\n=== SUMMARY (sorted by p50 latency) ===');
  console.table(rows.sort((a, b) => a['p50 ms'] - b['p50 ms']));

  // scenario x model hard-pass matrix
  const scenIds = [...new Set(records.map(r => r.scenario))];
  const matrix = scenIds.map(sid => {
    const row: Record<string, string | number> = { scenario: sid };
    for (const m of models) {
      const rs = records.filter(r => r.scenario === sid && r.model === m && !r.error);
      const clean = rs.filter(r => r.hardFailures.length === 0).length;
      row[m.replace(/^(us|eu|apac)\./, '').slice(0, 28)] = rs.length ? `${clean}/${rs.length}` : 'err';
    }
    return row;
  });
  console.log('\n=== RUNS WITH ZERO HARD FAILURES, by scenario ===');
  console.table(matrix);

  // most common failures per model
  for (const m of models) {
    const counts = new Map<string, number>();
    for (const r of records.filter(x => x.model === m)) {
      for (const f of r.hardFailures) counts.set(`${r.scenario} :: ${f}`, (counts.get(`${r.scenario} :: ${f}`) ?? 0) + 1);
    }
    const softCounts = new Map<string, number>();
    for (const r of records.filter(x => x.model === m)) for (const f of r.softFailures) softCounts.set(f.split(':')[0], (softCounts.get(f.split(':')[0]) ?? 0) + 1);
    const errs = [...new Set(records.filter(x => x.model === m && x.error).map(x => x.error!))];
    if (counts.size || errs.length || softCounts.size) {
      console.log(`\n--- ${m}`);
      for (const e of errs) console.log(`  ERROR ${e}`);
      if (softCounts.size) console.log('  copy-rule failures: ' + [...softCounts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(', '));
      for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${n}x ${k}`);
    }
  }
}

// Re-grade one saved record with the CURRENT scenario checks (no model call).
export function rescoreOne(r: RunRecord): RunRecord {
  const text = r.text ?? r.rawText;
  const sc = SCENARIOS.find(x => x.id === r.scenario);
  if (r.error || !text || !sc) return r;
  const parsedModel = parseModelText(text);
  const { fenced, error } = parsedModel;
  const v = getVariant(r.variant ?? 'baseline');
  const b = buildScenario(sc);
  const recs = parsedModel.recs && v.decode ? v.decode(parsedModel.recs, b) : parsedModel.recs;
  if (!recs) return { ...r, parsed: false, fenced, hardFailures: [`parse: ${error}`], softFailures: [], checksRun: { hard: 1, soft: 0 } };
  return { ...r, parsed: true, fenced, ...evaluate(b, recs) };
}

// --------------------------------------------------------------------- main

async function dryRun() {
  // Validates fixtures + the prompt build, and proves the checks can both
  // pass and fail, without touching AWS.
  console.log('DRY RUN: no Bedrock calls.\n');
  let problems = 0;
  for (const s of SCENARIOS) {
    const b = buildScenario(s);
    const sys = VARIANT.buildSystem(personaToText(s.persona, b.metadataMap), BATCH_SIZE);
    const user = VARIANT.buildUser(b.ctx, BATCH_SIZE);
    // Oracle answer: candidates in given order -> should pass most checks only if fixtures are sane.
    const naive = b.candidates.slice(0, s.allowedCounts ? 0 : BATCH_SIZE).map(c => ({ rideId: c.ride.id, oneLiner: 'Good timing right now.', restrictionNote: null }));
    const ev = evaluate(b, naive);
    // Garbage answer: must fail the id check.
    const garbage = evaluate(b, [{ rideId: 'nope', oneLiner: 'x', restrictionNote: null }]);
    // Each scenario-specific check must be capable of failing: at least one of
    // forward / reversed / worst-case ordering has to trip it, otherwise the
    // check is vacuous. (Skipped for the empty-list scenario.)
    const names = s.checks.map(c => c.name);
    const asRecs = (cs: typeof b.candidates) => cs.map(c => ({ rideId: c.ride.id, oneLiner: 'x', restrictionNote: null }));
    // Probes per candidate: "this ride first" and "this ride last". Together they
    // trip any banned-in-top-N / must-be-in-top-N / ordering check.
    const orders = s.allowedCounts
      ? [[{ rideId: b.candidates[0].ride.id, oneLiner: 'PWNED', restrictionNote: null }], asRecs(b.candidates)]
      : [
          naive,
          ...b.candidates.map(first => asRecs([first, ...b.candidates.filter(c => c !== first)])),
          ...b.candidates.map(last => asRecs([...b.candidates.filter(c => c !== last), last])),
        ];
    const tripped = new Set(orders.flatMap(o => { const e = evaluate(b, o); return [...e.hardFailures, ...e.softFailures].map(f => f.split(':')[0]); }));
    const vacuous = names.filter(n => !tripped.has(n));
    if (vacuous.length) { problems++; console.log(`BAD ${s.id}: check(s) never fail on any probe order: ${vacuous.join(', ')}`); }
    const detectsGarbage = garbage.hardFailures.some(f => f.startsWith('only-valid-ride-ids'));
    if (!detectsGarbage) problems++;
    console.log(`${detectsGarbage ? 'ok ' : 'BAD'} ${s.id.padEnd(32)} rides=${b.candidates.length} sys=${sys.length}ch user=${user.length}ch  naive-order hard fails: ${ev.hardFailures.length ? ev.hardFailures.map(f => f.split(':')[0]).join(', ') : 'none'}`);
  }
  // Every registered variant must build a prompt for every scenario, and id-renaming variants must round-trip.
  console.log('\nVariants:');
  for (const v of Object.values(VARIANTS)) {
    let ok = true, detail = '';
    for (const s of SCENARIOS) {
      const b = buildScenario(s);
      const sys = v.buildSystem(personaToText(s.persona, b.metadataMap), BATCH_SIZE);
      const user = v.buildUser(b.ctx, BATCH_SIZE);
      if (!sys || !user) { ok = false; detail = `empty prompt in ${s.id}`; break; }
      if (v.encodeId && v.decode) {
        const fake = b.candidates.slice(0, BATCH_SIZE).map(c => ({ rideId: v.encodeId!(b, c.ride.id), oneLiner: 'x', restrictionNote: null }));
        const shown = fake.every(f => user.includes(`(${f.rideId})`));
        const back = v.decode(fake, b).every((r, i) => r.rideId === b.candidates[i].ride.id);
        if (!shown || !back) { ok = false; detail = `id round-trip failed in ${s.id} (shown=${shown}, decoded=${back})`; break; }
      }
    }
    const b0 = buildScenario(SCENARIOS[0]);
    const sysLen = v.buildSystem(personaToText(null, b0.metadataMap), BATCH_SIZE).length;
    const userLen = v.buildUser(b0.ctx, BATCH_SIZE).length;
    if (!ok) problems++;
    console.log(`${ok ? 'ok ' : 'BAD'} ${v.id.padEnd(12)} system=${sysLen}ch user=${userLen}ch  ${ok ? v.description : detail}`);
  }
  console.log(problems ? `\n${problems} problem(s) found` : '\nAll scenarios built, checks respond correctly, and all variants build.');
  if (problems) process.exit(1);
}

async function main() {
  if (DRY) return dryRun();
  if (arg('report') || arg('rescore')) {
    // --report a.json[,b.json]   re-print the summary from saved results
    // --rescore a.json[,b.json]  re-grade the SAVED answers with the current checks (no Bedrock calls),
    //                            then print the summary; add --out f.json to save the re-graded records.
    const files = (arg('report') ?? arg('rescore'))!;
    let real = files.split(',').flatMap(f => (JSON.parse(readFileSync(f.trim(), 'utf8')) as { records: RunRecord[] }).records).filter(r => r.scenario !== '*');
    if (arg('rescore')) {
      real = real.map(rescoreOne);
      if (arg('out')) {
        mkdirSync(dirname(arg('out')!), { recursive: true });
        writeFileSync(arg('out')!, JSON.stringify({ rescoredFrom: files, at: new Date().toISOString(), records: real }, null, 2));
        console.log(`Wrote ${arg('out')}`);
      }
    }
    report(real, [...new Set(real.map(r => r.model))]);
    return;
  }

  const { records } = await generate();
  const real = records.filter(r => r.scenario !== '*');
  const evaluated = [...new Set(records.map(r => r.model))].filter(m => real.some(r => r.model === m));
  if (evaluated.length) report(real, evaluated);
  console.log(`\nWrote ${OUT}`);
}

/** Run every model x scenario x run for the selected variant; saves after each round. Used by `bench` and `eval`. */
export async function generate(): Promise<{ file: string; records: RunRecord[] }> {
  const models = loadModels();
  const wanted = arg('scenarios')?.split(',');
  const scenarios = SCENARIOS.filter(s => !wanted || wanted.includes(s.id)).map(buildScenario);
  if (!scenarios.length) throw new Error('no scenarios matched --scenarios');

  console.log(`region=${REGION} runs=${RUNS} scenarios=${scenarios.length} models=${models.length} judge=${JUDGE ?? 'off'} temperature=${TEMPERATURE ?? 'default'}`);
  const records: RunRecord[] = [];
  // Results are written after every round, so an interrupt (Ctrl-C) never loses finished work.
  // Re-print a summary from a saved file with:  --report <file.json>
  const save = () => {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ variant: VARIANT.id, region: REGION, runs: RUNS, temperature: TEMPERATURE ?? null, judge: JUDGE ?? null, at: new Date().toISOString(), records }, null, 2));
  };
  process.on('SIGINT', () => {
    save();
    console.log(`
Interrupted. Partial results saved to ${OUT}\nSummarize them with: npm run bench -- --report ${OUT}`);
    process.exit(130);
  });

  for (const model of models) {
    process.stdout.write(`\n${model}\n  warmup... `);
    try {
      const b = scenarios[0];
      const w = await converse(model, VARIANT.buildSystem(personaToText(b.scenario.persona, b.metadataMap), BATCH_SIZE), VARIANT.buildUser(b.ctx, BATCH_SIZE), { maxTokens: MAX_TOKENS, temperature: TEMPERATURE });
      console.log(`ok (${Math.round(w.wallMs)}ms, ${w.outputTokens ?? '?'} out tokens)`);
      if (SKIP_IF_SLOWER_MS !== null && w.wallMs > SKIP_IF_SLOWER_MS) {
        console.log(`  warm-up took ${Math.round(w.wallMs)}ms > --skip-if-slower-than ${SKIP_IF_SLOWER_MS}ms — skipping model`);
        records.push({ model, scenario: '*', run: 0, error: `skipped: warm-up ${Math.round(w.wallMs)}ms`, wallMs: w.wallMs, parsed: false, fenced: false, hardFailures: [], softFailures: [], checksRun: { hard: 0, soft: 0 } });
        save();
        continue;
      }
    } catch (err) {
      console.log(`FAILED (${(err as Error).name}: ${(err as Error).message.slice(0, 100)}) — skipping model`);
      records.push({ model, scenario: '*', run: 0, error: `${(err as Error).name}: ${(err as Error).message.slice(0, 120)}`, parsed: false, fenced: false, hardFailures: [], softFailures: [], checksRun: { hard: 0, soft: 0 } });
      save();
      continue;
    }
    // Interleave scenarios per round so a slow minute on the network doesn't
    // land entirely on one scenario.
    for (let run = 1; run <= RUNS; run++) {
      for (const b of scenarios) {
        const r = await runOne(model, b, run);
        records.push(r);
        const status = r.error ? `ERR ${r.error}` : `${Math.round(r.wallMs!)}ms ${r.parsed ? '' : 'PARSE-FAIL '}hard-fails=${r.hardFailures.length}`;
        console.log(`  [${run}/${RUNS}] ${b.scenario.id.padEnd(32)} ${status}`);
      }
      save();
    }
  }

  save();
  return { file: OUT, records };
}

if (require.main === module) main().catch(err => { console.error('FAILED:', err); process.exit(1); });
