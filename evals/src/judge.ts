// AI judge: pass/fail questions about one answer, each with a one-line reason. Covers only what code
// cannot check reliably. Judges are pointers for a human reviewer: validate them with
// `npm run judge-check` (known good and bad answers) before trusting their numbers.

import { readFileSync } from 'fs';
import { join } from 'path';
import { EVALS_ROOT } from './args';
import { converse } from './llm';
import { extractJson } from './parse';
import { BuiltFixture, ResolvedRec } from './types';

export const JUDGE_VERSION = 'spec-2026-11-18-v4'; // v4: skip framing = justified, not scripted; new specific-reason question. // v2: go/skip/star only as labels; party-tied descriptions ok. v3: judge only rides shown to the model; mechanical copy rules left to code; correct rounded math is grounded; restrictions only as marked in the data

export const CRITERIA = [
  { id: 'grounded', label: 'Claims match the data', q: 'Every factual claim (shorter or longer than usual, rising, falling, holding, "rarely this short", any time or number, any fact about a ride such as its type) matches the data or is true of the real ride. Correctly rounded arithmetic from the data counts as grounded. This question is about facts only, not style.' },
  { id: 'present-tense', label: 'Every pick is a do-it-now move', q: "Every pick is something to walk to now. No pick's own caption tells the guest to come back later; a later drop appears only as a reason on a different pick." },
  { id: 'skip-framing', label: 'Skip picks justified', q: 'Each picked ride whose verdict is skip has a caption that explains why a ride with a skip badge is being recommended at all (a busy day with nothing better, or a ride the guest marked and a line that will not improve). No positive-timing words on it. Answer "na" when no skip-verdict ride was picked.' },
  { id: 'restrictions', label: 'Restrictions handled honestly', q: 'A picked ride whose "restricted for" column is not "none" is never presented as a clean fit: the caption or note names who it affects (rider swap for height; one person sits out for pregnancy). Only the data decides which rides are restricted. Answer "na" if no restricted ride was picked.', na: true },
  { id: 'strongest-reason', label: 'Leads with the strongest reason', q: 'Each caption leads with the single strongest reason this ride earned its spot now and adds something the card (name, wait, walk) does not already show.' },
  { id: 'specific', label: 'Reason is specific to this ride and party', q: 'Each caption says something a friend would know about THIS ride, THIS party, or THIS moment: what the ride is like (gentle, dark, soaking, intense, short, a coaster, a boat), who in the party it suits or does not, what the guest said they want, or the conditions (heat, rain, dark, closing soon). A caption made only of line facts (shorter or longer than normal, the trend, the walk, just reopened, "go now") is generic even when every number is right, because it would read the same on any ride. Fail if any caption is generic.' },
  { id: 'voice', label: 'Voice', q: 'Confident, warm and plain, like a friend who knows the park. No hype, hedging or filler.' },
  { id: 'ranking', label: 'Ranking fits the spec', q: "The order follows the ranking rules and this scenario's expectation, judged only among the rides that were shown to the model." },
] as const;
export type CriterionId = (typeof CRITERIA)[number]['id'];

export interface CriterionResult { pass: boolean | null; why: string } // null = not applicable
export interface Judgement { judge: string; fixture: string; run: number; results: Partial<Record<CriterionId, CriterionResult>> }
/** Why a judge call produced nothing usable (API error, no JSON, missing answers). */
export interface JudgeFailure { judge: string; fixture: string; run: number; error: string }
export const isJudgement = (x: Judgement | JudgeFailure | null): x is Judgement => !!x && 'results' in x;

const rules = () => readFileSync(join(EVALS_ROOT, 'config', 'judge-rules.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();

const clock = (min: number) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

export function describeParty(b: BuiltFixture): string {
  const p = b.persona;
  if (!p) return 'Guest skipped intake (default persona: adults, thrill-forward, not first-timers).';
  const parts: string[] = [];
  if (p.youngestAge != null) parts.push(p.youngestAge >= 18 ? 'All adults.' : `Youngest in the party is ${p.youngestAge}.`);
  const needs = p.accessibilityNeeds.filter(n => n !== 'none');
  if (needs.length) parts.push(`Needs: ${needs.join(', ')}.`);
  if (p.ridePreferences.length) parts.push(`Prefers: ${p.ridePreferences.join(', ')}.`);
  const wanted = b.rides.filter(r => r.wanted).map(r => r.name);
  parts.push(wanted.length ? `Still wants: ${wanted.join(', ')}.` : 'No wanted rides.');
  return parts.join(' ');
}

/** The situation as a readable table: the facts the judge (and the HTML report) use. */
/** `offered`: the rides this prompt version actually showed the model (omit = all of them). */
export function situationLines(b: BuiltFixture, offered?: string[]): string[] {
  const L = [
    `Park: ${b.fx.park === 'disneyland' ? 'Disneyland' : 'Disney California Adventure'}. Time: ${b.fx.localTime}. Closes: ${b.fx.hours ? b.fx.hours.close : 'unknown'}${b.minutesUntilClose != null ? ` (${b.minutesUntilClose} min from now)` : ''}. Field: ${b.field}.`,
    `Guest is standing at: ${b.rides.find(r => r.isAnchor)!.name}.`,
    `Party: ${describeParty(b)}`,
    '',
    'Ride | wait | usual | vs usual | walk | verdict | wanted | restricted for | notes | forecast',
  ];
  const hidden = offered ? b.rides.filter(r => !offered.includes(r.name)).map(r => r.name) : [];
  if (hidden.length) L.splice(3, 0, `NOT SHOWN TO THE MODEL (removed by this prompt version, so it could not pick them; do not penalize the answer for leaving them out): ${hidden.join(', ')}.`);
  for (const r of b.rides) {
    const fc = r.buckets.slice(1, 4).map((w, i) => `${w} at ${clock(b.fx.nowMin + 30 * (i + 1))}`).join(', ');
    const notes = [hidden.includes(r.name) ? 'NOT shown to the model' : '', r.isAnchor ? 'guest is here' : '', r.ridden ? 'already ridden this trip' : '', r.minutesSinceReopen != null ? `reopened ${r.minutesSinceReopen} min ago` : '', r.window ? `best later: ${r.window.wait} at ${clock(b.fx.nowMin + r.window.inMin)}` : '', r.reachableBeforeClose ? '' : 'cannot reach before close'].filter(Boolean).join('; ');
    L.push(`${r.name} | ${r.wait} | ${r.usual ?? '?'} | ${r.ofUsual ?? '?'} (${r.vsUsual != null && r.vsUsual > 0 ? '+' : ''}${r.vsUsual ?? '?'}) | ${r.walk} min | ${r.verdict} | ${r.wanted ? 'yes' : 'no'} | ${r.restrictedFor.join(', ') || 'none'} | ${notes || '-'} | ${fc}`);
  }
  return L;
}

const SYSTEM = () => `SPEC JUDGE. You review one answer from a theme-park ride recommender against a written spec. The recommender picks rides for a guest to do next and writes a one-sentence card caption for each. The card already shows the ride name, wait and walk time.

The spec's rules:
<rules>
${rules()}
</rules>

For each question below, decide pass or fail for the WHOLE answer, with a one-line reason that quotes the ride or caption at fault. Be strict and specific. Do not reward length or enthusiasm. Use "na" only where a question allows it.

Two things are handled elsewhere, so do not use them to decide any question:
- Mechanical copy rules (em dashes, percentages, exclamation marks, the ride's own name, app vocabulary) are checked by code.
- Rides marked "NOT shown to the model" could not be picked. If the scenario expectation names such a ride, ignore that part of the expectation.

Questions:
${CRITERIA.map(c => `- ${c.id}: ${c.q}`).join('\n')}

Reply with ONLY a JSON object: {${CRITERIA.map(c => `"${c.id}":{"pass":true|false${'na' in c ? '|"na"' : ''},"why":"..."}`).join(',')}}`;

export async function judgeAnswer(judge: string, b: BuiltFixture, recs: ResolvedRec[], run: number, offered?: string[]): Promise<Judgement | JudgeFailure> {
  const user = [
    `## Scenario ${b.fx.id}: ${b.fx.title}`,
    ...situationLines(b, offered),
    '', `What the spec expects here: ${b.fx.expectation}`,
    '', '## The answer (rank order)',
    ...recs.map((r, i) => `${i + 1}. ${r.ride ?? `UNKNOWN RIDE (${r.rawId})`}: "${r.oneLiner}"${r.restrictionNote ? ` [restriction note: ${r.restrictionNote}]` : ''}`),
  ].join('\n');
  const fail = (error: string): JudgeFailure => ({ judge, fixture: b.fx.id, run, error });
  let text: string;
  try {
    // Generous limit: newer Claude models think by default and that counts toward max tokens;
    // too low a limit truncates the JSON. No sampling params are sent.
    text = (await converse(judge, SYSTEM(), user, { maxTokens: 4000 })).text;
  } catch (err) {
    return fail(`${(err as Error).name}: ${(err as Error).message.slice(0, 200)}`);
  }
  let j: any;
  try { j = extractJson(text); } catch { return fail(`reply had no JSON object. Reply starts: ${JSON.stringify(text.slice(0, 160))}`); }
  const results: Judgement['results'] = {};
  for (const c of CRITERIA) {
    const v = j[c.id];
    if (!v) continue;
    const p = v.pass;
    results[c.id] = { pass: p === 'na' || p === null ? null : p === true || p === 'true', why: String(v.why ?? '').slice(0, 240) };
  }
  return Object.keys(results).length ? { judge, fixture: b.fx.id, run, results } : fail(`JSON had none of the expected questions. Keys: ${Object.keys(j).slice(0, 8).join(', ')}`);
}

export async function pool<T>(tasks: (() => Promise<T>)[], size: number, onDone?: (n: number) => void): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); onDone?.(++done); }
  }));
  return out;
}
