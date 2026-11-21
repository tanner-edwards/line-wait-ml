// No AWS. Proves the harness is sound before any money is spent:
//  1. every fixture builds and every variant renders it;
//  2. each fixture's IDEAL answer passes every hard check and scenario rule;
//  3. each fixture's BAD answer fails at least one;
//  4. every code check fires on a deliberate violation (no check is silently dead);
//  5. code+name id decoding (spec section 5) behaves.
import { codeChecks, scenarioChecks } from './checks';
import { buildFixture } from './fixtures/derive';
import { FIXTURES, fixtureById } from './fixtures/scenarios';
import { AnswerRow, BuiltFixture, ResolvedRec } from './types';
import { decodeCodeName, VARIANTS } from './variants';

let problems = 0;
const bad = (msg: string) => { problems++; console.log(`  BAD ${msg}`); };
const toRecs = (rows: AnswerRow[], b: BuiltFixture): ResolvedRec[] => rows.map(r => {
  if (!b.byName.has(r.ride)) throw new Error(`${b.fx.id}: reference answer names unknown ride "${r.ride}"`);
  return { ride: r.ride, rawId: r.ride, oneLiner: r.caption, restrictionNote: r.note ?? null };
});
const allChecks = (recs: ResolvedRec[] | null, b: BuiltFixture) => {
  const offered = b.rides.map(r => r.name); // spec behavior: every reachable ride incl. the anchor is offered
  return [...codeChecks(recs, b, offered), ...scenarioChecks(recs, b, offered)];
};

console.log('Fixtures and reference answers');
for (const fx of FIXTURES) {
  const b = buildFixture(fx);
  const restricted = b.rides.filter(r => r.restrictedFor.length).map(r => `${r.name.split(' ')[0]}(${r.restrictedFor.join('+')})`).join(' ');
  const ideal = allChecks(toRecs(fx.ideal, b), b).filter(c => !c.pass && c.severity === 'hard');
  // Any failed check counts as catching the bad answer: caption-wording asserts are soft since 2026-11-19.
  const badFails = allChecks(toRecs(fx.bad, b), b).filter(c => !c.pass);
  const renders = Object.values(VARIANTS).map(v => { const r = v.render(b); return r.system && r.user ? `${v.id}:${r.offered.length} rides` : `${v.id}:EMPTY`; });
  console.log(`${ideal.length || !badFails.length ? 'BAD' : 'ok '} ${fx.id.padEnd(4)} field=${b.field.padEnd(5)} ${renders.join(' ')}  restricted: ${restricted || 'none'}`);
  for (const c of ideal) bad(`${fx.id} ideal answer fails "${c.label}": ${c.detail}`);
  if (!badFails.length) bad(`${fx.id} bad answer passes every check (the asserts are too weak)`);
}

console.log('\nEvery code check can fail');
type Probe = { fx: string; rows: AnswerRow[]; expect: string; nowMin?: number };
const P = (fx: string, expect: string, ...rows: AnswerRow[]): Probe => ({ fx, expect, rows });
const probes: Probe[] = [
  P('S1', 'name-template', { ride: 'Pirates of the Caribbean', caption: 'Pirates is half its usual line.' }, { ride: 'Jungle Cruise', caption: 'Jungle Cruise is shorter than usual.' }),
  P('S1', 'percent', { ride: 'Pirates of the Caribbean', caption: 'About 50% of its usual line.' }),
  P('S1', 'em-dash', { ride: 'Pirates of the Caribbean', caption: 'Half its usual line — go now.' }),
  P('S1', 'exclaim', { ride: 'Pirates of the Caribbean', caption: 'Half its usual line!' }),
  P('S1', 'vocab', { ride: 'Pirates of the Caribbean', caption: 'A go verdict and an easy ride.' }),
  P('S1', 'vocab', { ride: 'Jungle Cruise', caption: 'A star ride for your group today.' }),
  P('S1', 'rank3-no-others', { ride: 'Pirates of the Caribbean', caption: 'Half its usual line.' }, { ride: 'Jungle Cruise', caption: 'Gentle and shorter than usual.' }, { ride: 'Haunted Mansion', caption: 'Calmer than Pirates right now.' }),
  P('S1', 'numbers', { ride: 'Pirates of the Caribbean', caption: 'Down to 12 minutes within 1.5 hours.' }),
  P('S1', 'restricted-note', { ride: 'Indiana Jones Adventure', caption: 'About half its usual line.' }),
  P('S1', 'dupes', { ride: 'Pirates of the Caribbean', caption: 'Half its usual line.' }, { ride: 'Pirates of the Caribbean', caption: 'Half its usual line.' }),
  P('S1', 'count'),
  P('S1', 'count', ...Array(7).fill({ ride: 'Jungle Cruise', caption: 'Gentle.' })),
  P('S2A', 'restricted-wanted', { ride: 'Star Wars: Rise of the Resistance', caption: 'Close to half its usual line.' }),
  P('S3', 'rare-needs-data', { ride: 'Big Thunder Mountain Railroad', caption: 'Rarely this short, go now.' }),
  P('S4', 'skip-positive', { ride: 'Dumbo the Flying Elephant', caption: 'A great deal with a short line.' }),
  P('S7', 'reopen-not-rare', { ride: 'Space Mountain', caption: 'A great deal right next door.' }),
  { ...P('S6', 'reachable', { ride: 'Space Mountain', caption: 'Line up before close and you still ride.' }), nowMin: 22 * 60 + 50 },
];
for (const p of probes) {
  const fx = { ...fixtureById(p.fx), ...(p.nowMin ? { nowMin: p.nowMin } : {}) };
  const b = buildFixture(fx);
  const failed = codeChecks(toRecs(p.rows, b), b, b.rides.map(r => r.name)).filter(c => !c.pass).map(c => c.id);
  const ok = failed.includes(p.expect);
  console.log(`${ok ? 'ok ' : 'BAD'} ${p.expect.padEnd(18)} ${p.fx}`);
  if (!ok) bad(`check "${p.expect}" did not fire (fired: ${failed.join(', ') || 'none'})`);
}
// Must NOT fire: a ride name containing "Star" is not app vocabulary.
{
  const b = buildFixture(fixtureById('S2'));
  const f = codeChecks(toRecs([{ ride: "Peter Pan's Flight", caption: 'Shorter than Star Wars: Rise of the Resistance right now.' }], b), b, b.rides.map(r => r.name)).filter(c => !c.pass).map(c => c.id);
  console.log(`${f.includes('vocab') ? 'BAD' : 'ok '} ride names are not vocabulary`);
  if (f.includes('vocab')) bad('"Star Wars" in a ride name was flagged as app vocabulary');
}
// Unknown ride id.
{
  const b = buildFixture(fixtureById('S1'));
  const f = codeChecks([{ ride: null, rawId: 'nope', oneLiner: 'x', restrictionNote: null }], b, b.rides.map(r => r.name)).filter(c => !c.pass).map(c => c.id);
  console.log(`${f.includes('ids') ? 'ok ' : 'BAD'} ids                S1`);
  if (!f.includes('ids')) bad('unknown ride id not caught');
}

console.log('\nCode + name ids (spec section 5)');
const codes = new Map([['r1', 'Space Mountain'], ['r3', 'Big Thunder Mountain Railroad']]);
const cases: [string, string | null][] = [['r3 Big Thunder Mountain Railroad', 'Big Thunder Mountain Railroad'], ['R3  big thunder mountain railroad', 'Big Thunder Mountain Railroad'], ['r3', 'Big Thunder Mountain Railroad'], ['r3 Space Mountain', null], ['r9 Space Mountain', null], ['Big Thunder', null]];
for (const [input, want] of cases) {
  const got = decodeCodeName([{ rideId: input, oneLiner: 'x', restrictionNote: null }], codes)[0].ride;
  console.log(`${got === want ? 'ok ' : 'BAD'} ${JSON.stringify(input).padEnd(36)} -> ${got ?? 'dropped'}`);
  if (got !== want) bad(`decode ${input}: got ${got}, want ${want}`);
}

console.log(problems ? `\n${problems} problem(s) found.` : '\nAll fixtures, reference answers, checks and id decoding are sound.');
process.exit(problems ? 1 : 0);
