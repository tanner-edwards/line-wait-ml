// AI judge: pass/fail questions about one answer, each with a one-line reason. Covers only what code
// cannot check reliably. Judges are pointers for a human reviewer: validate them with
// `npm run judge-check` (known good and bad answers) before trusting their numbers.

import { readFileSync } from 'fs';
import { join } from 'path';
import { EVALS_ROOT } from './args';
import { converse } from './llm';
import { extractJson } from './parse';
import { BuiltFixture, ResolvedRec } from './types';

export const JUDGE_VERSION = 'spec-2026-11-16-v1';

export const CRITERIA = [
  { id: 'grounded', label: 'Claims match the data', q: 'Every claim about a line (shorter or longer than usual, rising, falling, holding, "rarely this short", any time or number) matches the ride data. No invented numbers or ride facts.' },
  { id: 'present-tense', label: 'Every pick is a do-it-now move', q: "Every pick is something to walk to now. No pick's own caption tells the guest to come back later; a later drop appears only as a reason on a different pick." },
  { id: 'skip-framing', label: 'Skip picks framed honestly', q: 'Each picked ride whose verdict is skip opens (first clause) with busy-day or least-bad framing, or for a wanted ride "you wanted this and it won\'t get shorter". No positive-timing words. Answer "na" if no skip-verdict ride was picked.', na: true },
  { id: 'restrictions', label: 'Restrictions handled honestly', q: 'A picked ride restricted for this party is never presented as a clean fit: the caption or note names who it affects (rider swap for height with two adults; one person sits out for pregnancy). Answer "na" if no restricted ride was picked.', na: true },
  { id: 'strongest-reason', label: 'Leads with the strongest reason', q: 'Each caption leads with the single strongest reason this ride earned its spot now and adds something the card (name, wait, walk) does not already show.' },
  { id: 'voice', label: 'Voice', q: 'Confident, warm and plain, like a friend who knows the park. No hype, hedging or filler.' },
  { id: 'ranking', label: 'Ranking fits the spec', q: "The order follows the ranking rules and this scenario's expectation." },
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
export function situationLines(b: BuiltFixture): string[] {
  const L = [
    `Park: ${b.fx.park === 'disneyland' ? 'Disneyland' : 'Disney California Adventure'}. Time: ${b.fx.localTime}. Closes: ${b.fx.hours ? b.fx.hours.close : 'unknown'}${b.minutesUntilClose != null ? ` (${b.minutesUntilClose} min from now)` : ''}. Field: ${b.field}.`,
    `Guest is standing at: ${b.rides.find(r => r.isAnchor)!.name}.`,
    `Party: ${describeParty(b)}`,
    '',
    'Ride | wait | usual | vs usual | walk | verdict | wanted | restricted for | notes | forecast',
  ];
  for (const r of b.rides) {
    const fc = r.buckets.slice(1, 4).map((w, i) => `${w} at ${clock(b.fx.nowMin + 30 * (i + 1))}`).join(', ');
    const notes = [r.isAnchor ? 'guest is here' : '', r.minutesSinceReopen != null ? `reopened ${r.minutesSinceReopen} min ago` : '', r.window ? `best later: ${r.window.wait} at ${clock(b.fx.nowMin + r.window.inMin)}` : '', r.reachableBeforeClose ? '' : 'cannot reach before close'].filter(Boolean).join('; ');
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

Questions:
${CRITERIA.map(c => `- ${c.id}: ${c.q}`).join('\n')}

Reply with ONLY a JSON object: {${CRITERIA.map(c => `"${c.id}":{"pass":true|false${'na' in c ? '|"na"' : ''},"why":"..."}`).join(',')}}`;

export async function judgeAnswer(judge: string, b: BuiltFixture, recs: ResolvedRec[], run: number): Promise<Judgement | JudgeFailure> {
  const user = [
    `## Scenario ${b.fx.id}: ${b.fx.title}`,
    ...situationLines(b),
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
