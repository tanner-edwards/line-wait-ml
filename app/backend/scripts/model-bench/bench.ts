// Bedrock model benchmark for the /v2/recommendations prompt.
//
// For each model x scenario x run it: builds the production prompt, calls
// Bedrock (Converse API, so any model family works), times the full round
// trip, parses the answer, and scores it against deterministic checks.
// Optionally asks a stronger "judge" model to grade ranking/copy quality.
//
// Usage (from app/backend):
//   AWS_REGION=us-west-2 npx tsx scripts/model-bench/bench.ts \
//       [--models id1,id2 | --models-file scripts/model-bench/models.json] \
//       [--scenarios default-adult-saturday,toddler-family] \
//       [--runs 5] [--judge us.anthropic.claude-sonnet-4-5-20250929-v1:0] \
//       [--temperature 0] [--max-tokens 2000] [--out results/run.json]
//   npx tsx scripts/model-bench/bench.ts --dry-run     # no AWS calls; validates fixtures + checks
//   OPENAI_API_KEY=... npx tsx scripts/model-bench/bench.ts --list-models openai   # also: gemini (GEMINI_API_KEY)
//
// Model ids: Bedrock ids as-is; "openai:<model>" and "gemini:<model>" call those APIs directly
// (see models.json). Extra flags: --reasoning-effort <v> (OpenAI), --gemini-thinking-budget <n>.
//
// Latency is wall-clock around the SDK call (what a Lambda would wait), which
// is the number that matters since the endpoint is non-streaming. The
// server-side `metrics.latencyMs` from Bedrock is recorded alongside it.

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { buildSystemPrompt, buildUserMessage } from '../../src/recommendations/promptBuilder';
import { personaToText } from '../../src/recommendations/persona';
import {
  BATCH_SIZE, BuiltScenario, GENERIC_CHECKS, ParsedRec, SCENARIOS, buildScenario,
} from './scenarios';

// ---------------------------------------------------------------- CLI args

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const REGION = arg('region', process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-west-2')!;
const RUNS = Number(arg('runs', '3'));
const MAX_TOKENS = Number(arg('max-tokens', '2000'));
const TEMPERATURE = arg('temperature') !== undefined ? Number(arg('temperature')) : undefined; // unset = same as production
const JUDGE = arg('judge');
const OUT = arg('out');
const DRY = flag('dry-run');

function loadModels(): string[] {
  const inline = arg('models');
  if (inline) return inline.split(',').map(s => s.trim()).filter(Boolean);
  const file = arg('models-file', `${__dirname}/models.json`)!;
  return (JSON.parse(readFileSync(file, 'utf8')) as { models: { id: string }[] }).models.map(m => m.id);
}

// ------------------------------------------------------------------ helpers

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

// Same fence-stripping the handler does, but we record that it was needed.
function parseModelText(text: string): { recs: ParsedRec[] | null; fenced: boolean; error?: string } {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = m ? m[1].trim() : trimmed;
  try {
    const root = JSON.parse(body) as { recommendations?: unknown };
    if (!Array.isArray(root.recommendations)) return { recs: null, fenced: !!m, error: 'no recommendations array' };
    const recs: ParsedRec[] = [];
    for (const e of root.recommendations as Record<string, unknown>[]) {
      if (typeof e?.rideId !== 'string' || typeof e?.oneLiner !== 'string') return { recs: null, fenced: !!m, error: 'malformed entry' };
      recs.push({ rideId: e.rideId, oneLiner: e.oneLiner, restrictionNote: typeof e.restrictionNote === 'string' ? e.restrictionNote : null });
    }
    return { recs, fenced: !!m };
  } catch (err) {
    return { recs: null, fenced: !!m, error: `invalid JSON: ${(err as Error).message.slice(0, 60)}` };
  }
}

// ------------------------------------------------------------------ Bedrock

const client = DRY ? null : new BedrockRuntimeClient({ region: REGION });

interface CallResult {
  text: string;
  wallMs: number;
  serverMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

async function converseBedrock(modelId: string, system: string, user: string, opts: { maxTokens: number; temperature?: number }): Promise<CallResult> {
  const cmd = new ConverseCommand({
    modelId,
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: user }] }],
    inferenceConfig: { maxTokens: opts.maxTokens, ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}) },
  });
  // Retry only throttling, and never count the wait toward latency.
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    try {
      const res = await client!.send(cmd);
      const wallMs = performance.now() - t0;
      const text = (res.output?.message?.content ?? []).map(c => ('text' in c ? c.text : '')).join('');
      return {
        text,
        wallMs,
        serverMs: res.metrics?.latencyMs ?? null,
        inputTokens: res.usage?.inputTokens ?? null,
        outputTokens: res.usage?.outputTokens ?? null,
      };
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'ThrottlingException' && attempt < 4) { await sleep(2000 * 2 ** attempt); continue; }
      throw err;
    }
  }
}


// ---------------------------------------------------- non-Bedrock providers
//
// Model ids are routed by prefix: "openai:<model>" -> OpenAI API,
// "gemini:<model>" -> Google Gemini API, anything else -> Bedrock.
// These go over the public internet (not your AWS region), so their latency
// includes a network path Bedrock doesn't have; compare with that in mind.
// Keys come from OPENAI_API_KEY / GEMINI_API_KEY.

const REASONING_EFFORT = arg('reasoning-effort');            // OpenAI reasoning models, e.g. minimal | low | none
const GEMINI_THINKING_BUDGET = arg('gemini-thinking-budget'); // Gemini: 0 disables thinking where supported

function needKey(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function httpJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ json: any; wallMs: number }> {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const wallMs = performance.now() - t0;
    if ((res.status === 429 || res.status === 503) && attempt < 4) { await sleep(2000 * 2 ** attempt); continue; }
    const text = await res.text();
    if (!res.ok) { const e = new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`); e.name = `Http${res.status}`; throw e; }
    return { json: JSON.parse(text), wallMs };
  }
}

async function converseOpenAI(model: string, system: string, user: string, opts: { maxTokens: number; temperature?: number }): Promise<CallResult> {
  const { json, wallMs } = await httpJson('https://api.openai.com/v1/chat/completions',
    { authorization: `Bearer ${needKey('OPENAI_API_KEY')}` },
    {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      // Newer models reject max_tokens; max_completion_tokens covers hidden reasoning tokens too.
      max_completion_tokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT } : {}),
    });
  return {
    text: json.choices?.[0]?.message?.content ?? '',
    wallMs,
    serverMs: null,
    inputTokens: json.usage?.prompt_tokens ?? null,
    outputTokens: json.usage?.completion_tokens ?? null, // includes reasoning tokens
  };
}

async function converseGemini(model: string, system: string, user: string, opts: { maxTokens: number; temperature?: number }): Promise<CallResult> {
  const { json, wallMs } = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { 'x-goog-api-key': needKey('GEMINI_API_KEY') },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: opts.maxTokens,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(GEMINI_THINKING_BUDGET !== undefined ? { thinkingConfig: { thinkingBudget: Number(GEMINI_THINKING_BUDGET) } } : {}),
      },
    });
  const parts: { text?: string; thought?: boolean }[] = json.candidates?.[0]?.content?.parts ?? [];
  const u = json.usageMetadata ?? {};
  return {
    text: parts.filter(p => !p.thought).map(p => p.text ?? '').join(''),
    wallMs,
    serverMs: null,
    inputTokens: u.promptTokenCount ?? null,
    outputTokens: u.candidatesTokenCount != null ? u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0) : null,
  };
}

function converse(modelId: string, system: string, user: string, opts: { maxTokens: number; temperature?: number }): Promise<CallResult> {
  if (modelId.startsWith('openai:')) return converseOpenAI(modelId.slice(7), system, user, opts);
  if (modelId.startsWith('gemini:')) return converseGemini(modelId.slice(7), system, user, opts);
  return converseBedrock(modelId, system, user, opts);
}

async function listModels(provider: string) {
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${needKey('OPENAI_API_KEY')}` } });
    const j = await r.json() as { data?: { id: string }[] };
    console.log((j.data ?? []).map(m => `openai:${m.id}`).sort().join('\n'));
  } else if (provider === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': needKey('GEMINI_API_KEY') } });
    const j = await r.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    console.log((j.models ?? []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => `gemini:${m.name.replace('models/', '')}`).sort().join('\n'));
  } else {
    throw new Error('--list-models takes "openai" or "gemini" (for Bedrock: aws bedrock list-inference-profiles)');
  }
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

interface RunRecord {
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
  rawText?: string;
}

function evaluate(b: BuiltScenario, recs: ParsedRec[]) {
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
  const system = buildSystemPrompt(personaToText(b.scenario.persona, b.metadataMap), BATCH_SIZE);
  const user = buildUserMessage(b.ctx, BATCH_SIZE);
  const base = { model, scenario: b.scenario.id, run };
  try {
    const call = await converse(model, system, user, { maxTokens: MAX_TOKENS, temperature: TEMPERATURE });
    const { recs, fenced, error } = parseModelText(call.text);
    if (!recs) {
      return { ...base, ...call, parsed: false, fenced, hardFailures: [`parse: ${error}`], softFailures: [], checksRun: { hard: 1, soft: 0 }, rawText: call.text.slice(0, 500) };
    }
    const ev = evaluate(b, recs);
    return { ...base, ...call, parsed: true, fenced, ...ev, judge: await judge(b, user, call.text), rawText: ev.hardFailures.length ? call.text.slice(0, 800) : undefined };
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

// --------------------------------------------------------------------- main

async function dryRun() {
  // Validates fixtures + the prompt build, and proves the checks can both
  // pass and fail, without touching AWS.
  console.log('DRY RUN: no Bedrock calls.\n');
  let problems = 0;
  for (const s of SCENARIOS) {
    const b = buildScenario(s);
    const sys = buildSystemPrompt(personaToText(s.persona, b.metadataMap), BATCH_SIZE);
    const user = buildUserMessage(b.ctx, BATCH_SIZE);
    // Oracle answer: candidates in given order -> should pass most checks only if fixtures are sane.
    const naive = b.candidates.slice(0, s.expectEmpty ? 0 : BATCH_SIZE).map(c => ({ rideId: c.ride.id, oneLiner: 'Good timing right now.', restrictionNote: null }));
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
    const orders = s.expectEmpty
      ? [[{ rideId: b.candidates[0].ride.id, oneLiner: 'PWNED', restrictionNote: null }]]
      : [
          naive,
          ...b.candidates.map(first => asRecs([first, ...b.candidates.filter(c => c !== first)])),
          ...b.candidates.map(last => asRecs([...b.candidates.filter(c => c !== last), last])),
        ];
    const tripped = new Set(orders.flatMap(o => evaluate(b, o).hardFailures.map(f => f.split(':')[0])));
    const vacuous = names.filter(n => !tripped.has(n));
    if (vacuous.length) { problems++; console.log(`BAD ${s.id}: check(s) never fail on any probe order: ${vacuous.join(', ')}`); }
    const detectsGarbage = garbage.hardFailures.some(f => f.startsWith('only-valid-ride-ids'));
    if (!detectsGarbage) problems++;
    console.log(`${detectsGarbage ? 'ok ' : 'BAD'} ${s.id.padEnd(32)} rides=${b.candidates.length} sys=${sys.length}ch user=${user.length}ch  naive-order hard fails: ${ev.hardFailures.length ? ev.hardFailures.map(f => f.split(':')[0]).join(', ') : 'none'}`);
  }
  console.log(problems ? `\n${problems} scenario(s) failed validation` : '\nAll scenarios built and checks respond correctly.');
  if (problems) process.exit(1);
}

async function main() {
  if (DRY) return dryRun();
  if (arg('list-models')) return listModels(arg('list-models')!);

  const models = loadModels();
  const wanted = arg('scenarios')?.split(',');
  const scenarios = SCENARIOS.filter(s => !wanted || wanted.includes(s.id)).map(buildScenario);
  if (!scenarios.length) throw new Error('no scenarios matched --scenarios');

  console.log(`region=${REGION} runs=${RUNS} scenarios=${scenarios.length} models=${models.length} judge=${JUDGE ?? 'off'} temperature=${TEMPERATURE ?? 'default'}`);
  const records: RunRecord[] = [];

  for (const model of models) {
    process.stdout.write(`\n${model}\n  warmup... `);
    try {
      const b = scenarios[0];
      await converse(model, buildSystemPrompt(personaToText(b.scenario.persona, b.metadataMap), BATCH_SIZE), buildUserMessage(b.ctx, BATCH_SIZE), { maxTokens: MAX_TOKENS, temperature: TEMPERATURE });
      console.log('ok');
    } catch (err) {
      console.log(`FAILED (${(err as Error).name}: ${(err as Error).message.slice(0, 100)}) — skipping model`);
      records.push({ model, scenario: '*', run: 0, error: `${(err as Error).name}: ${(err as Error).message.slice(0, 120)}`, parsed: false, fenced: false, hardFailures: [], softFailures: [], checksRun: { hard: 0, soft: 0 } });
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
    }
  }

  const real = records.filter(r => r.scenario !== '*');
  const evaluated = [...new Set(records.map(r => r.model))].filter(m => real.some(r => r.model === m));
  if (evaluated.length) report(real, evaluated);

  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ region: REGION, runs: RUNS, temperature: TEMPERATURE ?? null, judge: JUDGE ?? null, at: new Date().toISOString(), records }, null, 2));
    console.log(`\nWrote ${OUT}`);
  }
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
