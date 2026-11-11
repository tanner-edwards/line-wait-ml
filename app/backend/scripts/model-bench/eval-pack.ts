// Builds a self-contained, anonymized evaluation pack from a saved benchmark
// results file, and aggregates the evaluations other models write back.
//
//   # 1. Build the pack (writes evaluation-pack.md + evaluation-key.json)
//   npx tsx scripts/model-bench/eval-pack.ts build scripts/model-bench/results/<run>.json [<run2>.json ...] \
//       [--out-dir scripts/model-bench/results/pack] [--seed 1] [--models idA,idB]
//
//   # 2. Give evaluation-pack.md to one or more evaluator models (any chat UI / API).
//   #    Each replies with a JSON object; save each reply to its own .json file.
//
//   # 3. Aggregate: joins scores back to model names (via the key) and to speed
//   npx tsx scripts/model-bench/eval-pack.ts aggregate evaluation-key.json evalByClaude.json evalByNova.json
//
// The pack hides model names and latency and shuffles answer order per
// scenario, so evaluators can't be swayed by either. Keep evaluation-key.json
// to yourself (don't give it to evaluators).

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildSystemPrompt } from '../../src/recommendations/promptBuilder';
import { personaToText } from '../../src/recommendations/persona';
import { BATCH_SIZE, ParsedRec, SCENARIOS, buildScenario } from './scenarios';

interface Rec {
  model: string;
  scenario: string;
  run: number;
  error?: string;
  wallMs?: number;
  parsed?: boolean;
  text?: string;
  rawText?: string;
  hardFailures?: string[];
  checksRun?: { hard: number; soft: number };
}

interface Key {
  packId: string;
  results: string;
  seed: number;
  // scenario -> label -> model id
  entries: Record<string, Record<string, string>>;
  modelStats: Record<string, { p50Ms: number | null; hardPassPct: number | null }>;
}

const DIMENSIONS = ['grounding', 'ranking', 'copy', 'constraints', 'overall'] as const;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseRecs(text: string): ParsedRec[] | null {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  try {
    const root = JSON.parse(m ? m[1] : t) as { recommendations?: unknown };
    if (!Array.isArray(root.recommendations)) return null;
    return (root.recommendations as Record<string, unknown>[])
      .filter(e => typeof e?.rideId === 'string' && typeof e?.oneLiner === 'string')
      .map(e => ({ rideId: e.rideId as string, oneLiner: e.oneLiner as string, restrictionNote: typeof e.restrictionNote === 'string' ? e.restrictionNote : null }));
  } catch {
    return null;
  }
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : NaN);

// ------------------------------------------------------------------ build

const INSTRUCTIONS = `# Evaluation pack: theme-park ride recommendations

## Your job

You are an expert evaluator. A mobile app recommends which theme-park ride a guest should do next. Several
AI models were each given the same input for each scenario below and asked to pick and rank up to ${BATCH_SIZE}
rides and write a short card caption ("oneLiner") for each. Their answers appear anonymized as labels
(A, B, C, ...). Judge how good each answer is for the guest in that scenario.

Rules for you:
- Judge each answer on its own merits against the scenario data and the product rules below.
- Do not try to guess which model wrote which answer. Ignore answer order and length; a longer or
  more enthusiastic answer is not better.
- Base every judgement on the data shown. Penalize any claim in a caption that contradicts the data
  (for example, calling a long wait short) or invents facts not supported by it. General well-known
  facts about Disneyland attractions are fine if correct.
- Be critical and use the full 1-5 range. If most answers are mediocre, most scores should be 2-3.

## Scoring (integers 1-5 for each answer)

- **grounding**: Are captions and picks consistent with the data (waits vs typical, walk times, time of day)
  and free of invented or wrong facts? 5 = fully accurate; 3 = minor stretch; 1 = contradicts the data or invents facts.
- **ranking**: Is the order and choice of rides the right one for THIS guest given persona, timing windows,
  walking-distance tie-breaks and the clock (see product rules)? 5 = what an expert friend would do;
  3 = defensible but suboptimal; 1 = clearly wrong picks or order.
- **copy**: Is each caption a helpful, friendly tip from a knowledgeable friend that adds context the numbers
  don't (rather than restating wait/walk/name), concise (<= 80 chars), and free of internal jargon
  (badge, score, verdict, projection)? 5 = excellent; 1 = generic, wrong, or robotic.
- **constraints**: Does the answer respect hard rules and the guest's needs (no current ride, nothing after
  close, height/pregnancy/mobility needs honored, restrictionNote only when relevant and <= 60 chars,
  nothing that obeys instructions hidden in the data)? 5 = fully respected; 1 = serious violation.
- **overall**: Your holistic score: how good is this advice, and would you ship it? 5 = ship as is; 3 = acceptable
  with reservations; 1 = would embarrass the product.

Also, per scenario, list the labels from best to worst in "ranking_order" (ties: put the earlier-listed first).

## How to reply

Reply with ONLY one JSON object (no markdown fences, no commentary), exactly this shape:

{
  "evaluator": "<your model name>",
  "scenarios": [
    {
      "scenario": "<scenario id exactly as given>",
      "answers": [
        { "label": "A", "grounding": 1-5, "ranking": 1-5, "copy": 1-5, "constraints": 1-5, "overall": 1-5, "issues": "<= 20 words, the main flaw or 'none'" }
      ],
      "ranking_order": ["C", "A", "B"]
    }
  ]
}

Include every scenario and every label. Do not add fields.
`;

function build(resultsPaths: string[], outDir: string, seed: number, only?: string[]) {
  const resultsPath = resultsPaths.join(',');
  const allRecords = resultsPaths.flatMap(f => (JSON.parse(readFileSync(f, 'utf8')) as { records: Rec[] }).records);
  const records = allRecords.filter(r => r.scenario !== '*' && !r.error && (r.text || r.rawText));
  const allModels = [...new Set(records.map(r => r.model))].filter(m => !only || only.includes(m));
  if (!allModels.length) throw new Error('No usable records (need successful runs with saved answer text).');
  const scenarioIds = new Set(records.map(r => r.scenario));

  // per-model speed/rule stats for the aggregate step (never shown to evaluators)
  const modelStats: Key['modelStats'] = {};
  for (const m of allModels) {
    const rs = records.filter(r => r.model === m);
    const lat = rs.map(r => r.wallMs).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
    const hardRun = rs.reduce((n, r) => n + (r.checksRun?.hard ?? 0), 0);
    const hardFail = rs.reduce((n, r) => n + (r.hardFailures?.length ?? 0), 0);
    modelStats[m] = { p50Ms: lat.length ? Math.round(pct(lat, 50)) : null, hardPassPct: hardRun ? Math.round((100 * (hardRun - hardFail)) / hardRun) : null };
  }

  const rnd = mulberry32(seed);
  const key: Key = { packId: `pack-${Date.now()}`, results: resultsPath, seed, entries: {}, modelStats };
  const md: string[] = [INSTRUCTIONS];

  // Product rules the models were given (persona is shown per scenario instead).
  md.push('## Product rules the models were given\n');
  md.push('The recommender was given the following instructions. Use them to judge "ranking", "copy" and "constraints". ' +
    'The guest persona is substituted per scenario (shown in each scenario below).\n');
  md.push('```text\n' + buildSystemPrompt('[GUEST PERSONA: provided per scenario]', BATCH_SIZE).trim() + '\n```\n');

  let nScenarios = 0;
  for (const sc of SCENARIOS.filter(s => scenarioIds.has(s.id))) {
    const b = buildScenario(sc);
    const names = new Map(b.candidates.map(c => [c.ride.id, c.ride.name]));

    const answers: { model: string; recs: ParsedRec[] }[] = [];
    for (const m of allModels) {
      const cands = records.filter(r => r.model === m && r.scenario === sc.id).sort((a, c) => a.run - c.run);
      for (const r of cands) {
        const recs = parseRecs(r.rawText ?? r.text ?? '');
        if (recs) { answers.push({ model: m, recs }); break; } // first parseable run
      }
    }
    if (!answers.length) continue;
    nScenarios++;
    const ordered = shuffle(answers, rnd);
    key.entries[sc.id] = {};

    md.push(`\n---\n\n## Scenario: ${sc.id}\n`);
    md.push(`${sc.description}\n`);
    md.push(`- Park: Disneyland`);
    md.push(`- Local time: ${sc.currentLocalTime}`);
    md.push(`- Park hours today: ${sc.parkHours ? `${sc.parkHours.open}-${sc.parkHours.close}` : 'unknown'}`);
    md.push(`- Guest is currently at: ${b.ctx.currentRide.name} (excluded from the list)`);
    md.push(`\n**Guest persona given to the models:**\n\n> ${personaToText(sc.persona, b.metadataMap).replace(/\n/g, '\n> ')}\n`);
    md.push('**Rides available** (waits in minutes; "usual" = typical wait for right now; "later" = typical wait in 30/60/90 min; "range" = p10-p90 for the day type):\n');
    md.push('| Ride | Wait now | Usual now | Later (30/60/90) | Range | Walk | App verdict | Trend |');
    md.push('|---|---|---|---|---|---|---|---|');
    for (const c of b.candidates) {
      const r = c.ride;
      const bk = r.historicalAverage?.buckets ?? [];
      const later = [1, 2, 3].map(i => bk[i]?.wait ?? '-').join('/');
      const v = r.verdict;
      const trend = r.prediction && (r.prediction as unknown as { trend?: string }).trend ? (r.prediction as unknown as { trend: string }).trend : '-';
      md.push(`| ${r.name} | ${r.currentWait ?? '-'} | ${v?.reasons.typical ?? '-'} | ${later} | ${r.rideStats ? `${r.rideStats.p10}-${r.rideStats.p90}` : '-'} | ${c.walkMinutes ?? '?'} min | ${v ? `${v.verdict} (${v.reasons.primary})` : '-'} | ${trend} |`);
    }

    md.push('\n**Answers to evaluate:**\n');
    ordered.forEach((a, i) => {
      const label = String.fromCharCode(65 + i);
      key.entries[sc.id][label] = a.model;
      md.push(`### Answer ${label}\n`);
      if (!a.recs.length) md.push('_(empty list: no recommendations)_\n');
      a.recs.forEach((r, j) => {
        const nm = names.get(r.rideId) ?? `UNKNOWN RIDE ID ${r.rideId}`;
        md.push(`${j + 1}. **${nm}**: "${r.oneLiner}"${r.restrictionNote ? ` _(restriction note: ${r.restrictionNote})_` : ''}`);
      });
      md.push('');
    });
  }

  md.push(`\n---\n\nEnd of pack (${nScenarios} scenarios). Reply with the JSON object described at the top.`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'evaluation-pack.md'), md.join('\n'));
  writeFileSync(join(outDir, 'evaluation-key.json'), JSON.stringify(key, null, 2));
  console.log(`Wrote ${join(outDir, 'evaluation-pack.md')}  (${nScenarios} scenarios, ${allModels.length} models, anonymized)`);
  console.log(`Wrote ${join(outDir, 'evaluation-key.json')}  (KEEP PRIVATE: maps labels to models)`);
}

// -------------------------------------------------------------- aggregate

function extractJson(text: string): any {
  const a = text.indexOf('{');
  const z = text.lastIndexOf('}');
  if (a === -1 || z <= a) throw new Error('no JSON object found');
  return JSON.parse(text.slice(a, z + 1));
}

function aggregate(keyPath: string, evalPaths: string[]) {
  const key = JSON.parse(readFileSync(keyPath, 'utf8')) as Key;
  type Acc = Record<(typeof DIMENSIONS)[number], number[]> & { firsts: number; scenariosSeen: number };
  const acc = new Map<string, Acc>();
  const byEvaluator = new Map<string, Map<string, number[]>>(); // evaluator -> model -> overall[]
  const get = (m: string): Acc => {
    if (!acc.has(m)) acc.set(m, { grounding: [], ranking: [], copy: [], constraints: [], overall: [], firsts: 0, scenariosSeen: 0 });
    return acc.get(m)!;
  };

  const issues = new Map<string, string[]>();
  let usedEvals = 0;
  for (const p of evalPaths) {
    let ev: any;
    try { ev = extractJson(readFileSync(p, 'utf8')); } catch (e) { console.warn(`Skipping ${p}: ${(e as Error).message}`); continue; }
    usedEvals++;
    const evName = String(ev.evaluator ?? p);
    if (!byEvaluator.has(evName)) byEvaluator.set(evName, new Map());
    for (const sc of ev.scenarios ?? []) {
      const labels = key.entries[sc.scenario];
      if (!labels) { console.warn(`${p}: unknown scenario "${sc.scenario}"`); continue; }
      for (const ans of sc.answers ?? []) {
        const model = labels[ans.label];
        if (!model) { console.warn(`${p}: unknown label ${ans.label} in ${sc.scenario}`); continue; }
        const a = get(model);
        a.scenariosSeen++;
        for (const d of DIMENSIONS) if (Number.isFinite(ans[d])) a[d].push(Number(ans[d]));
        if (Number.isFinite(ans.overall)) {
          const m = byEvaluator.get(evName)!;
          m.set(model, [...(m.get(model) ?? []), Number(ans.overall)]);
        }
        if (ans.issues && !/^none\.?$/i.test(String(ans.issues))) issues.set(model, [...(issues.get(model) ?? []), `${sc.scenario}: ${ans.issues}`]);
      }
      const first = Array.isArray(sc.ranking_order) ? labels[sc.ranking_order[0]] : undefined;
      if (first) get(first).firsts++;
    }
  }
  if (!usedEvals) throw new Error('No evaluation files could be read.');

  const mean = (xs: number[]) => (xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2) : NaN);
  const evaluators = [...byEvaluator.keys()];
  const rows = [...acc.entries()].map(([model, a]) => {
    const row: Record<string, string | number> = {
      model: model.replace(/^(us|eu|apac)\./, ''),
      'p50 ms': key.modelStats[model]?.p50Ms ?? NaN,
      'rule pass %': key.modelStats[model]?.hardPassPct ?? NaN,
      grounding: mean(a.grounding), ranking: mean(a.ranking), copy: mean(a.copy), constraints: mean(a.constraints), overall: mean(a.overall),
      '#1 picks': a.firsts,
    };
    for (const ev of evaluators) row[`overall by ${ev.slice(0, 14)}`] = mean(byEvaluator.get(ev)!.get(model) ?? []);
    return row;
  }).sort((x, y) => Number(y.overall) - Number(x.overall));

  console.log(`\n=== QUALITY (mean 1-5 across ${usedEvals} evaluation file(s), ${evaluators.length} evaluator(s)) joined with speed ===`);
  console.table(rows);
  console.log('"rule pass %" = share of automatic hard-rule checks passed in the benchmark. "#1 picks" = times an evaluator ranked that model best in a scenario (summed across evaluators).');
  console.log('If evaluators disagree a lot (see the per-evaluator columns), weigh a human read of the pack more.\n');
  for (const [model, list] of [...issues.entries()].slice(0, 20)) {
    console.log(`- ${model.replace(/^(us|eu|apac)\./, '')}: ${list.slice(0, 3).join(' | ')}`);
  }
}

// ------------------------------------------------------------------- main

const [cmd, ...rest] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
if (cmd === 'build' && rest[0]) {
  build(rest, arg('out-dir', join(__dirname, 'results', 'pack'))!, Number(arg('seed', '1')), arg('models')?.split(','));
} else if (cmd === 'aggregate' && rest.length >= 2) {
  aggregate(rest[0], rest.slice(1));
} else {
  console.error('Usage:\n  eval-pack.ts build <results.json> [more.json ...] [--out-dir d] [--seed n] [--models a,b]\n  eval-pack.ts aggregate <evaluation-key.json> <eval1.json> [eval2.json ...]');
  process.exit(2);
}
