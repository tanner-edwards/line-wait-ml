// Builds a self-contained Markdown file for an independent reviewer (e.g. ChatGPT or Gemini in a
// chat window) to sanity-check a saved run: the real answers, the automatic check results, and the
// AI judge's verdicts. The reviewer judges each answer first, then says where it disagrees with the
// judge, and flags any check or scenario expectation it thinks is wrong.
//
//   npm run review-pack                     # latest run in site/, first run of each scenario
//   npm run review-pack -- --run <runId>    # a specific run (site/data/<runId>.json)
//   npm run review-pack -- --run-index 2    # use each scenario's 2nd run instead
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { arg, EVALS_ROOT } from './args';
import { buildFixture } from './fixtures/derive';
import { fixtureById } from './fixtures/scenarios';
import { grade } from './grade';
import { RunData } from './html';
import { CRITERIA, CriterionId, situationLines } from './judge';

const SITE = arg('site-dir', join(EVALS_ROOT, 'site'))!;
const dataDir = join(SITE, 'data');
if (!existsSync(dataDir)) throw new Error(`No saved runs in ${dataDir}. Run "npm run eval" first.`);
const runs = readdirSync(dataDir).filter(f => f.endsWith('.json')).sort();
const pick = arg('run') ? `${arg('run')!.replace(/\.json$/, '')}.json` : runs[runs.length - 1];
if (!pick || !runs.includes(pick)) throw new Error(`Run not found. Available: ${runs.map(r => r.replace('.json', '')).join(', ')}`);
const d = JSON.parse(readFileSync(join(dataDir, pick), 'utf8')) as RunData;
const runIndex = Number(arg('run-index', '1'));
const rules = readFileSync(join(EVALS_ROOT, 'config', 'judge-rules.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
const short = (m: string) => m.replace(/^(us|eu|apac|global)\./, '').replace(/-v\d+:\d+$/, '');

const L: string[] = [];
L.push('# Independent review: theme-park ride recommendations', '');
L.push('## Your job', '');
L.push('A mobile app asks an AI model which rides a guest at Disneyland should do next. The model returns a ranked list, each with a one-sentence card caption and an optional restriction note. The card already shows the ride name, wait and walk time. Below are real answers from the model for several scenarios, the results of automatic code checks, and the verdicts of an AI judge ("Judge A").');
L.push('', 'Please act as a second, independent judge:');
L.push('1. For each scenario, read the situation and the answer, and answer each question below yourself (pass, fail, or "na" where allowed) with a one-line reason. Do this BEFORE reading Judge A\'s verdicts.');
L.push('2. Then compare with Judge A. List every question where you disagree and say who is right and why.');
L.push('3. Flag anything in the setup you think is wrong: a scenario expectation that contradicts the rules, or an automatic check result that looks like a false alarm or a miss.');
L.push('', 'Judge strictly against the rules below, not your own taste. Do not reward length or enthusiasm.', '');
L.push('## The rules (from the product spec)', '', rules, '');
L.push('## Questions to answer for each scenario', '');
for (const c of CRITERIA) L.push(`- **${c.id}**: ${c.q}`);
L.push('', '## How to reply', '');
L.push('For each scenario: a short table of your verdicts, then your disagreements with Judge A. End with one JSON block in exactly this shape so the results can be tallied:', '');
L.push('```json');
L.push(JSON.stringify({ reviewer: '<your model name>', scenarios: { S1: { grounded: { pass: true, why: '...' }, '...': '...' } }, disagreements: [{ scenario: 'S1', question: 'ranking', judge_a: 'fail', you: 'pass', who_is_right: 'you|judge_a|unclear', why: '...' }], setup_issues: [{ scenario: 'S1', issue: '...' }] }, null, 2));
L.push('```', '');

let n = 0;
for (const f of [...new Set(d.records.map(r => r.fixture))]) {
  const rec = d.records.find(r => r.fixture === f && r.run === runIndex) ?? d.records.find(r => r.fixture === f);
  if (!rec) continue;
  const b = buildFixture(fixtureById(f));
  const g = grade(rec, b);
  n++;
  L.push('---', '', `## Scenario ${f}: ${b.fx.title}`, '', `What it tests: ${b.fx.tests}`, '', `What the spec expects: ${b.fx.expectation}`, '');
  L.push('### Situation the model was given', '', '```text', ...situationLines(b), '```', '');
  const hidden = b.rides.filter(r => !(rec.offered ?? []).includes(r.name)).map(r => r.name);
  if (rec.offered?.length && hidden.length) L.push(`**Note:** this prompt version (${rec.variant}) never showed the model these rides, so it could not pick them: ${hidden.join(', ')}. Judge the answer on the rides it was given; the missing rides are a known limitation of this version, already counted by the automatic checks.`, '');
  L.push('### The answer (rank order)', '');
  if (g.recs) L.push(...(g.recs.length ? g.recs.map((r, i) => `${i + 1}. **${r.ride ?? `unknown ride id ${r.rawId}`}**: "${r.oneLiner}"${r.restrictionNote ? ` _(restriction note: ${r.restrictionNote})_` : ''}`) : ['_(empty list)_']));
  else L.push(`_(no usable answer: ${rec.error ?? 'invalid JSON'})_`);
  const failed = g.checks.filter(c => !c.pass);
  L.push('', '### Automatic code checks', '', failed.length ? failed.map(c => `- FAILED (${c.scenario ? 'scenario rule' : c.severity}): ${c.label}${c.detail ? ` [${c.detail}]` : ''}`).join('\n') : '- All passed.');
  const js = d.judgements.filter(j => j.fixture === f && j.run === rec.run);
  L.push('', '### Judge A\'s verdicts (read only after making your own call)', '');
  if (!js.length) L.push('_(not judged)_');
  for (const j of js.slice(0, 1)) for (const c of CRITERIA) {
    const r = j.results[c.id as CriterionId];
    if (r) L.push(`- ${c.id}: ${r.pass === null ? 'na' : r.pass ? 'pass' : 'fail'}: ${r.why}`);
  }
  L.push('');
}

const outDir = join(SITE, 'review');
mkdirSync(outDir, { recursive: true });
const out = arg('out') ?? join(outDir, `review-pack-${d.runId}.md`);
writeFileSync(out, L.join('\n'));
console.log(`Wrote ${out}`);
console.log(`${n} scenarios from run ${d.runId} (${d.variant}, ${short(d.model)}); Judge A = ${d.judges[0] ? short(d.judges[0]) : 'none'}.`);
console.log('Paste it into ChatGPT or Gemini (a non-Claude model), then send me the JSON block it returns.');
