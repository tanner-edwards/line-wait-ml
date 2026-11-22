// Held-out scenarios written by independent authors (ChatGPT and Gemini, 2026-11-22) from the
// packet `npm run holdout-pack` produces. They never saw the prompt, and we never tune on these:
// they are the check that a prompt gain on the authored scenarios is real.
//
// Source files live in evals/holdout/*.md in the packet's block format. Each block becomes a
// Fixture with id H-<author>-<n>; the `expect` lines become asserts. Reference answers (ideal /
// bad) are synthesized from the asserts so the Fixture shape holds; dry-run does not cover them.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVALS_ROOT } from '../args';
import { A } from '../checks';
import { Assert, Fixture, RideFact } from '../types';
import { Persona, RideCategory, AccessibilityNeed, TripDuration, Verdict } from '../../../app/backend/src/types';
import { rideMeta } from './derive';

/** Split a comma list of ride names, re-joining pieces of a name that itself contains a comma
 *  ("Monsters, Inc. Mike & Sulley to the Rescue!"). A piece that is not a known ride is tried
 *  joined with the next ones until it is. */
function rideList(s: string): string[] {
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let name = parts[i];
    let j = i;
    while (!known(name) && j + 1 < parts.length) { j++; name = `${name}, ${parts[j]}`; }
    out.push(canon(name)); i = j;
  }
  return out;
}
function known(name: string): boolean { try { rideMeta(canon(name)); return true; } catch { return false; } }

const HOLDOUT_DIR = join(EVALS_ROOT, 'holdout');
const DAY_MIN: Record<string, number> = {};
const clockToMin = (s: string): number => {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(s);
  if (!m) throw new Error(`holdout: cannot read time "${s}"`);
  let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const PARKS: Record<string, Fixture['park']> = { disneyland: 'disneyland', dl: 'disneyland', dca: 'california-adventure', 'california-adventure': 'california-adventure' };
// The authors wrote the en dash as the packet printed it; ride_metadata uses U+2013 too, but be lenient.
const canon = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/ - /g, ' – ').replace(/—/g, '–');

function parseBlock(text: string, author: string, n: number): Fixture {
  const line = (key: string) => { const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text); return m ? m[1].trim() : ''; };
  const title = /^### Scenario [^:]+:\s*(.*)$/m.exec(text)?.[1]?.trim() ?? `${author}-${n}`;
  const park = PARKS[line('park').toLowerCase()];
  if (!park) throw new Error(`holdout ${author}-${n}: unknown park "${line('park')}"`);
  const nowMin = clockToMin(line('time'));
  const closeMin = clockToMin(line('closes'));
  const hours = { open: '08:00', close: toHHMM(closeMin) };

  // party: youngest 6 | preferences: thrills, classics | watchlist: X, Y | needs: stroller | trip: 1-day
  const party: Record<string, string> = {};
  for (const part of line('party').split('|')) {
    const m = /^\s*(youngest|preferences|watchlist|needs|trip)\s*:?\s*(.*)$/i.exec(part);
    if (m) party[m[1].toLowerCase()] = m[2].trim();
  }
  const list = (s: string | undefined) => (!s || /^none$/i.test(s) ? [] : s.split(',').map(x => x.trim()).filter(Boolean));
  const youngest = party.youngest ?? 'adults';
  const persona: Persona = {
    tripDuration: (party.trip && !/^none$/i.test(party.trip) ? party.trip : null) as TripDuration | null,
    youngestAge: /^adults?$/i.test(youngest) ? 18 : Number(youngest),
    ridePreferences: list(party.preferences) as RideCategory[],
    mustDoRideIds: [],
    accessibilityNeeds: list(party.needs) as AccessibilityNeed[],
  };
  const watch = new Set(party.watchlist && !/^none$/i.test(party.watchlist) ? rideList(party.watchlist) : []);
  const standingAt = canon(line('standing at'));

  // rides table
  const rows = text.split('\n').filter(l => /^\|/.test(l)).slice(2);
  const rides: RideFact[] = rows.map(r => {
    const c = r.split('|').slice(1, -1).map(x => x.trim());
    const [name, wait, usual, walk, verdict, trend, note] = c;
    const w = Number(wait);
    const fact: RideFact = {
      name: canon(name), wait: w, usual: usual === '-' || usual === '' ? null : Number(usual), walk: Number(walk),
      verdict: verdict.toLowerCase() as Verdict, wanted: watch.has(canon(name)),
    };
    const t = /(falling|rising) to (\d+)/i.exec(trend ?? '');
    if (t) fact.buckets = [w, ...Array(5).fill(Number(t[2]))];
    const re = /reopened (\d+) min/i.exec(note ?? '');
    if (re) fact.minutesSinceReopen = Number(re[1]);
    if (/ridden/i.test(note ?? '')) fact.ridden = true;
    return fact;
  });
  const anchorIdx = rides.findIndex(r => r.name === standingAt);
  // When the author left the standing-at ride out of the table, it is a location only: mark it
  // ridden so the pool drops it (the Lambda does the same for excludeRideIds) instead of inventing
  // a candidate at walk 0 (H-gemini-3 once led with a made-up 10-minute Matterhorn).
  const anchor = anchorIdx >= 0 ? rides.splice(anchorIdx, 1)[0] : { name: standingAt, wait: 10, usual: 10, verdict: 'neutral' as Verdict, walk: 0, ridden: true };
  anchor.walk = 0;

  // expect lines
  const asserts: Assert[] = [];
  const expect: Record<string, string[]> = {};
  for (const m of text.matchAll(/^- (top two from|must not lead|must appear|must not appear):\s*(.*)$/gm)) {
    const v = m[2].trim();
    if (!v || /^\(optional\)$/i.test(v)) continue;
    expect[m[1]] = rideList(v);
  }
  if (expect['top two from']) asserts.push(A.topTwoFrom(expect['top two from']));
  for (const r of expect['must not lead'] ?? []) asserts.push(A.notRank1(r));
  for (const r of expect['must appear'] ?? []) asserts.push(A.present(r));
  for (const r of expect['must not appear'] ?? []) asserts.push(A.absent(r));
  if (!asserts.length) throw new Error(`holdout ${author}-${n}: no expect lines`);

  const why = line('why');
  const lead = expect['top two from'] ?? expect['must appear'] ?? [];
  const avoid = expect['must not lead']?.[0] ?? '';
  return {
    id: `H-${author}-${n}`,
    title,
    tests: line('tests'),
    park, localTime: line('time'), nowMin, hours, persona, anchor, rides,
    filled: [`Held-out scenario by ${author}; hours open 08:00 assumed; verdict reasons not given.`],
    asserts,
    expectation: why,
    ideal: lead.slice(0, 2).map(ride => ({ ride, caption: 'Shorter line than usual right now, and close by.' })),
    bad: avoid ? [{ ride: avoid, caption: 'Go now.' }] : [],
    badIsCodeOnly: true,
  };
}

function load(): Fixture[] {
  const out: Fixture[] = [];
  for (const f of readdirSync(HOLDOUT_DIR).filter(x => x.endsWith('.md')).sort()) {
    const author = f.replace(/-\d{4}-\d{2}-\d{2}\.md$/, '').replace(/\.md$/, '');
    const blocks = readFileSync(join(HOLDOUT_DIR, f), 'utf8').split(/^(?=### Scenario )/m).filter(b => b.startsWith('### Scenario'));
    blocks.forEach((b, i) => out.push(parseBlock(b, author, i + 1)));
  }
  return out;
}

export const HOLDOUT: Fixture[] = load();
export const holdoutById = (id: string): Fixture | undefined => HOLDOUT.find(f => f.id === id);
