// Code checks for one answer, from app spec "AI Recommendation Expectations" (2026-11-16),
// sections 5, 8, 9 and 11. Hard checks are rules the spec says are never violated; soft checks
// are style targets ("about a dozen words") or heuristics that the AI judge confirms.

import { Severity, Assert, BuiltFixture, CheckResult, DerivedRide, ResolvedRec } from './types';
import { rideMeta } from './fixtures/derive';
import { DEFERS } from '../../app/backend/src/recommendations/handler';
import { RideCategory } from '../../app/backend/src/types';
import { AGE_FIT_MIN, ageAppealFor, ageBand } from '../../app/backend/src/recommendations/ageAppeal';

// ----------------------------------------------------------------- age fit
// TouringPlans reader-survey appeal (0-5) per ride and age group, the age bands, and the floor
// all live in the backend's ageAppeal.ts (2026-11-22): the prompt's `fit low` flag and this
// check are the same table by construction, which is the point of the flag.
export { AGE_FIT_MIN, ageBand };

/** Appeal of a ride for this fixture's party, or undefined when the ride has no survey data. */
export function ageAppeal(ride: string, b: BuiltFixture): number | undefined {
  return ageAppealFor(ride, b.persona?.youngestAge);
}


export const BATCH = 6; // app's RECOMMENDATIONS_COUNT (spec section 3)

// Short names guests and copy use for a ride. Matched case-sensitively as whole words, so "Rise"
// (the ride) is caught but "lines rise" is not. Full names are matched case-insensitively.
const ALIASES: Record<string, string[]> = {
  'Indiana Jones Adventure': ['Indiana Jones', 'Indy'],
  'Pirates of the Caribbean': ['Pirates'],
  'Jungle Cruise': ['Jungle Cruise'],
  'Haunted Mansion': ['Haunted Mansion', 'Mansion'],
  'Big Thunder Mountain Railroad': ['Big Thunder', 'Thunder Mountain'],
  'Buzz Lightyear Astro Blasters': ['Buzz Lightyear', 'Buzz', 'Astro Blasters'],
  'Star Wars: Rise of the Resistance': ['Rise of the Resistance', 'Rise'],
  "Peter Pan's Flight": ['Peter Pan'],
  'Dumbo the Flying Elephant': ['Dumbo'],
  'Storybook Land Canal Boats': ['Storybook Land', 'Storybook', 'Canal Boats'],
  'Mad Tea Party': ['Mad Tea Party', 'Tea Party'],
  'Mark Twain Riverboat': ['Mark Twain', 'Riverboat'],
  'Space Mountain': ['Space Mountain', 'Space'],
  'Matterhorn Bobsleds': ['Matterhorn'],
  'Radiator Springs Racers': ['Radiator Springs', 'Racers'],
  'WEB SLINGERS: A Spider-Man Adventure': ['Web Slingers', 'WEB SLINGERS', 'Spider-Man'],
  'Incredicoaster': ['Incredicoaster'],
  'Guardians of the Galaxy – Mission: BREAKOUT!': ['Guardians of the Galaxy', 'Guardians', 'Mission: BREAKOUT'],
  "Soarin' Around the World": ["Soarin'", 'Soarin', "Soarin’"],
  'Toy Story Midway Mania!': ['Toy Story Midway Mania', 'Toy Story', 'Midway Mania'],
  'Monsters, Inc. Mike & Sulley to the Rescue!': ['Monsters, Inc.', 'Monsters Inc', 'Mike & Sulley'],
  'Grizzly River Run': ['Grizzly River Run', 'Grizzly'],
};

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function mentions(text: string, rideName: string): boolean {
  if (text.toLowerCase().includes(rideName.toLowerCase())) return true;
  return (ALIASES[rideName] ?? []).some(a => new RegExp(`(^|[^A-Za-z])${escRe(a)}([^A-Za-z]|$)`).test(text));
}
const stripRideNames = (text: string, b: BuiltFixture) => {
  let t = text;
  for (const r of b.rides) for (const n of [r.name, ...(ALIASES[r.name] ?? [])]) t = t.split(n).join(' ');
  return t;
};

// ----------------------------------------------------------------- vocabulary

/** Spec §8: never verdict, star, go, skip, badge, score, window, must-do, list. "go", "skip" and "star"
 *  are also plain English (the spec's own voice says "Go now" and "Skip Rise for now"), so they are
 *  banned only where they read as the app's labels ("star ride", "go verdict", "starred"). */
const BANNED = /\b(verdicts?|badges?|scores?|must[- ]?dos?)\b/i; // "list" and "window" allowed 2026-11-19: the user's watchlist, "nap window"
// "go ride it" is plain English, so only star/skip pair with "ride".
const BANNED_LABELS = /\b((star|go|skip)[- ]?(verdict|badge|rating|rated|label|pick)s?|(star|skip)[- ]?rides?|starred)\b/i;
const POSITIVE_TIMING = /\b(great time|good time|good deal|great deal|rare|rarely|short line|best window|steal|bargain)\b/i;
const PARTY_FACTOR = /(pregnan|expecting|wheelchair|transfer|sensory|sit (this|it) out|sits (this|it) out|one of you|rider swap|swap|height|tall enough|too short|under \d+ ?(in|inches)|toddler|little one|kid|child)/i;
const POSITION = /\b(first|second|(?<!\b(?:a|one) )third|top (pick|choice|spot)|number one|#1|ranked)\b/i;
// Spec: every pick is for right now; captions never order the picks into a route.
const ROUTE = /\b(go next(?! door)|next up|up next|and then|then head|after (you|that one)|when you're done|once you're done|on your way)\b/i; // "on the way" dropped 2026-11-19: usually a place, not a route
const COME_BACK = DEFERS; // same pattern as the production now-guard, so a hit here is a pick prod would drop
const BUSY_OPENING = /(busy|long (lines?|everywhere|wait)|lines are long|least bad|crowded|packed|every(thing|where)|won't get (any )?shorter|wanted|still want|eye on|hoping|radar|hurts the least|nothing is short|closest to (a )?normal|slammed|tough day|holiday)/i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Every number the data could justify, as minutes; plus clock parts and small counts (soft only). */
function allowedNumbers(b: BuiltFixture) {
  const mins = new Set<number>([15, 30, 45, 60, 90, 120, 150]);
  const add = (x: number | null | undefined) => { if (x != null && Number.isFinite(x)) mins.add(Math.round(Math.abs(x))); };
  for (const r of b.rides) {
    [r.wait, r.usual, r.vsUsual, r.walk, r.p10, r.p90, r.window?.wait, r.window?.inMin, r.minutesSinceReopen, ...r.buckets].forEach(add);
    for (const o of b.rides) add(r.wait - o.wait);
    for (const x of r.buckets) add(r.wait - x);
  }
  add(b.minutesUntilClose);
  const hours = new Set<number>([1, 2]);
  for (const r of b.rides) if (r.window) hours.add(Math.round(r.window.inMin / 60));
  if (b.minutesUntilClose != null) hours.add(Math.floor(b.minutesUntilClose / 60));
  const loose = new Set<number>([...mins, ...hours, 1, 2, 3, 4, 5, 6]);
  for (const r of b.rides) if (r.heightMinIn) loose.add(r.heightMinIn);
  // Ride facts the prompt shows (duration, thrill) are on the line, so they are grounded.
  for (const r of b.rides) { const m = rideMeta(r.name) as { duration_min?: number | null; thrill_level?: number | null }; add(m.duration_min); if (m.thrill_level) loose.add(m.thrill_level); }
  const clock = [b.fx.localTime, b.fx.hours?.close ?? '', b.fx.hours?.open ?? ''].join(' ');
  for (const n of clock.match(/\d+/g) ?? []) loose.add(Number(n) % 12 || 12), loose.add(Number(n));
  if (b.fx.weather) [b.fx.weather.tempF, b.fx.weather.feelsF].forEach(n => loose.add(n));
  return { mins, hours, loose };
}

// ----------------------------------------------------------------- generic checks

// Preference categories. Thrills means thrill 3 and up (Matterhorn, Big Thunder, Space); kid
// favorites is thrill 1, the rides the prompt itself names (carousels, Dumbo, Casey Jr.), so
// Pirates and Haunted Mansion do not count (tightened 2026-11-21: thrill 2 covered 13 of 21
// rides and the check could not fail); classics and immersive use the ride_metadata tags;
// first-time is the catch-all and fits every ride.
export function fitsCategory(d: DerivedRide, p: RideCategory): boolean {
  if (p === 'thrills') return d.thrillLevel != null && d.thrillLevel >= 3;
  if (p === 'kid-favorites') return d.thrillLevel === 1;
  if (p === 'classics') return d.categories.includes('classic');
  if (p === 'immersive') return d.categories.includes('immersive');
  return true; // first-time
}
/** A ride fits the party when it fits any selected category. No selection: nothing fits (the check is off). */
export function fitsPreference(d: DerivedRide, prefs: readonly RideCategory[]): boolean {
  return prefs.some(p => fitsCategory(d, p));
}

export function codeChecks(recs: ResolvedRec[] | null, b: BuiltFixture, offered: string[], parseError?: string): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (id: string, label: string, severity: 'hard' | 'soft', fail: string | null | undefined) =>
    out.push({ id, label, severity, pass: !fail, detail: fail || undefined });

  add('parse', 'Answer is valid JSON in the expected shape', 'hard', recs ? null : parseError ?? 'could not parse');
  if (!recs) return out;

  const ride = (r: ResolvedRec): DerivedRide | undefined => (r.ride ? b.byName.get(r.ride) : undefined);
  const named = recs.filter(r => r.ride);
  const caps = recs.map(r => r.oneLiner);
  const { mins, hours, loose } = allowedNumbers(b);

  add('ids', 'Every pick is a ride from the input', 'hard',
    recs.filter(r => !r.ride || !offered.includes(r.ride)).map(r => `"${r.rawId}"`).join(', ') || null);
  add('dupes', 'No ride listed twice', 'hard',
    named.length !== new Set(named.map(r => r.ride)).size ? 'duplicate ride' : null);
  add('count', `Between 1 and ${BATCH} picks`, 'hard', recs.length < 1 || recs.length > BATCH ? `${recs.length} picks` : null);
  add('reachable', 'Every pick reachable before close', 'hard',
    named.filter(r => ride(r) && !ride(r)!.reachableBeforeClose).map(r => r.ride).join(', ') || null);

  // 2026-11-19: a name or nickname now and then is fine (Tanner); what reads badly is the
  // template, so this flags an answer where two or more captions OPEN with their ride's name.
  add('name-template', "Captions don't each open with their ride's name (two or more in one answer)", 'soft', (() => {
    const opens = recs.filter(r => r.ride && [r.ride, ...(ALIASES[r.ride] ?? [])].some(n => new RegExp(`^${escRe(n)}('s)?\\b`, 'i').test(r.oneLiner.trim())));
    return opens.length >= 2 ? opens.map(r => `${r.ride}: "${r.oneLiner}"`).join(' | ') : null;
  })());
  add('rank3-no-others', 'Rank 3 and below name no other ride and no position', 'soft',
    recs.slice(2).map(r => {
      const other = b.rides.find(o => o.name !== r.ride && mentions(r.oneLiner, o.name));
      return other ? `names ${other.name}: "${r.oneLiner}"` : POSITION.test(r.oneLiner) ? `position word: "${r.oneLiner}"` : null;
    }).filter(Boolean).join(' | ') || null);
  add('vocab', 'No app vocabulary (verdict, star, badge, score, window, must-do)', 'hard',
    caps.map(c => stripRideNames(c, b)).map((c, i) => (BANNED.test(c) || BANNED_LABELS.test(c) ? `"${caps[i]}"` : null)).filter(Boolean).join(' | ') || null);
  add('percent', 'No percentages', 'hard', caps.find(c => /%|\bpercent/i.test(c)) ?? null);
  add('em-dash', 'No em dashes', 'hard', caps.find(c => c.includes('—')) ?? null);
  add('exclaim', 'No exclamation marks', 'hard', caps.find(c => c.includes('!')) ?? null);

  // Numbers: minutes/hours must exist in the data (the Radiator Springs "1.5 hours" incident).
  const badNums: string[] = [];
  for (const c of caps) {
    for (const m of c.matchAll(/(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(minutes?|mins?|min)\b/gi)) if (!mins.has(Number(m[1]))) badNums.push(`${m[0]} in "${c}"`);
    for (const m of c.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?)\b/gi)) if (!hours.has(Number(m[1]))) badNums.push(`${m[0]} in "${c}"`);
    for (const m of c.matchAll(/\d+\.\d+/g)) if (!badNums.some(x => x.includes(c))) badNums.push(`${m[0]} in "${c}"`);
  }
  add('numbers', 'Every wait or time in a caption comes from the data', 'hard', badNums.join(' | ') || null);
  const oddNums = caps.flatMap(c => (c.match(/\d+/g) ?? []).filter(n => !loose.has(Number(n))).map(n => `${n} in "${c}"`));
  add('numbers-other', 'Other numbers look grounded', 'soft', oddNums.join(' | ') || null);

  add('no-route', 'Captions never order the picks into a route (next, then, after, when you\x27re done)', 'hard',
    caps.filter(c => ROUTE.test(c)).map(c => `"${c}"`).join(' | ') || null);
  add('skip-positive', 'Skip-verdict picks use no positive-timing words', 'hard',
    recs.filter(r => ride(r)?.verdict === 'skip' && POSITIVE_TIMING.test(r.oneLiner)).map(r => `${r.ride}: "${r.oneLiner}"`).join(' | ') || null);
  add('reopen-not-rare', 'A recently reopened ride is never "rare" or "a great deal"', 'soft',
    recs.filter(r => { const d = ride(r); return d?.minutesSinceReopen != null && d.minutesSinceReopen <= 20 && /\b(rare|rarely|great deal|good deal)\b/i.test(r.oneLiner); })
      .map(r => `${r.ride}: "${r.oneLiner}"`).join(' | ') || null);
  add('rare-needs-data', '"Rare" only when the line is far below usual or a star verdict', 'hard',
    recs.filter(r => { const d = ride(r); return d && /\brare(ly)?\b/i.test(r.oneLiner) && !(d.ofUsual === 'far-below' || d.verdict === 'star'); })
      .map(r => `${r.ride}: "${r.oneLiner}"`).join(' | ') || null);
  add('restricted-note', 'A restricted ride (not wanted) carries a restriction note', 'hard',
    recs.filter(r => { const d = ride(r); return d && d.restrictedFor.length && !d.wanted && !(r.restrictionNote ?? '').trim(); })
      .map(r => `${r.ride} (${ride(r)!.restrictedFor.join(', ')})`).join(', ') || null);
  add('restricted-wanted', 'A restricted wanted ride says who it affects', 'hard',
    recs.filter(r => { const d = ride(r); return d && d.restrictedFor.length && d.wanted && !PARTY_FACTOR.test(`${r.oneLiner} ${r.restrictionNote ?? ''}`); })
      .map(r => `${r.ride}: "${r.oneLiner}"`).join(' | ') || null);

  // Age fit: the top two picks should appeal to the party's age band, unless the ride is wanted
  // (then it is their call) or the party asked for kid favorites and is 7 or over (a gentle ride
  // is the point). Under 7 the low-appeal rides are the intense ones, so kid favorites never
  // excuses them.
  const band = ageBand(b.persona?.youngestAge).label;
  const kidPref = band !== 'under 7' && (b.persona?.ridePreferences ?? []).includes('kid-favorites');
  add('age-fit', `Top 2 picks appeal to the party's ages (survey appeal at least ${AGE_FIT_MIN} for ${band})`, 'soft',
    kidPref ? null : recs.slice(0, 2).filter(r => { const d = ride(r); const v = r.ride ? ageAppeal(r.ride, b) : undefined; return d && !d.wanted && v != null && v < AGE_FIT_MIN; })
      .map(r => `${r.ride} (${ageAppeal(r.ride!, b)!.toFixed(1)} for ${band})`).join(', ') || null);

  // Preference fit (2026-11-21, Tanner): the selected categories are a boost of one step, not
  // a filter. A ride fits the party when it fits any selected category (fitsPreference above);
  // a top-two pick is held against the preferences only when it fits none of them while a
  // fitting ride, unrestricted, not a skip, with a verdict at least as good as the pick's, was
  // left out of the top two (a star beats a fitting go; a go does not beat a fitting go). The
  // boost earns one slot, not both: once any top-two pick fits, the other is free (S6: Haunted
  // Mansion first, then Big Thunder before close, Tanner 2026-11-21). Selecting nothing, or
  // first-time, turns the check off by itself. Wanted rides are their call.
  const prefs = b.persona?.ridePreferences ?? [];
  const fitsParty = (d: DerivedRide) => fitsPreference(d, prefs);
  const top2 = recs.slice(0, 2).map(ride).filter((d): d is DerivedRide => !!d);
  const tier: Record<string, number> = { skip: 0, neutral: 1, go: 2, star: 3 };
  const prefFails = (top2.some(fitsParty) ? [] : top2.filter(d => !d.wanted && !fitsParty(d))).flatMap(d => {
    const leftOut = b.rides.filter(x => !x.ridden && fitsParty(x) && !x.restrictedFor.length && x.verdict !== 'skip' && tier[x.verdict] >= tier[d.verdict] && !top2.includes(x));
    return leftOut.length ? [`${d.name} (thrill ${d.thrillLevel}${d.categories.length ? ', ' + d.categories.join('/') : ''}, ${d.verdict}) over ${leftOut.map(x => `${x.name} (${x.verdict})`).join(', ')}`] : [];
  });
  add('pref-fit', `Top 2 picks fit what the party asked for (${prefs.join(', ') || 'nothing selected'}) when the field allows`, 'soft', prefFails.join(' | ') || null);

  // Walk fit (2026-11-21, Tanner): saving time is the goal, so a ride is scored on net minutes
  // saved: how far under usual its line is, minus the walk. A line that is long now but drops
  // within 30 minutes counts at the dropping wait, so a clearly falling line is still a deal. A
  // top-two pick is held against this only when a ride at least 5 minutes closer was left out
  // of the top two with the same or better net score, and that closer ride is a real option for
  // this party: unrestricted, not a skip, fits what they asked for, and not below the age floor.
  // A great deal far away still leads (its net score carries the walk); the same deal closer
  // wins. Wanted rides are their call.
  // Same arithmetic as the backend's savesFor (the `saves` field on the ride line): the arrival
  // wait is the posted wait plus the t+0 to t+30 slope over the walk.
  const netSaved = (d: DerivedRide): number | null => {
    if (d.usual == null) return null;
    const b0 = d.buckets[0] ?? d.wait;
    const b1 = d.buckets[1] ?? d.wait;
    const arrive = Math.max(0, Math.round(d.wait + ((b1 - b0) / 30) * d.walk));
    const soon = Math.min(arrive, b1);
    return Math.round(d.usual - soon - d.walk);
  };
  const ageOk = (d: DerivedRide) => { const v = ageAppeal(d.name, b); return kidPref || v == null || v >= AGE_FIT_MIN; };
  const walkFails = top2.flatMap(d => {
    const mine = netSaved(d);
    if (d.wanted || mine == null) return [];
    const closer = b.rides.filter(x => !x.ridden && !top2.includes(x) && !x.restrictedFor.length && x.verdict !== 'skip' && (!prefs.length || fitsParty(x)) && ageOk(x) && x.walk + 5 <= d.walk && netSaved(x) != null && netSaved(x)! >= mine);
    return closer.length ? [`${d.name} (walk ${d.walk}, net ${mine}) over ${closer.map(x => `${x.name} (walk ${x.walk}, net ${netSaved(x)})`).join(', ')}`] : [];
  });
  add('walk-fit', 'Top 2 picks do not walk past a closer ride with the same or better net minutes saved', 'soft', walkFails.join(' | ') || null);

  // soft
  add('length', 'Caption about a dozen words (flags over 18)', 'soft',
    caps.filter(c => words(c) > 18).map(c => `${words(c)} words: "${c}"`).join(' | ') || null);
  add('note-length', 'Restriction note at most 60 characters', 'soft',
    recs.filter(r => (r.restrictionNote ?? '').length > 60).map(r => `${r.restrictionNote!.length} chars`).join(', ') || null);
  add('skip-opening', 'Skip picks open with busy-day framing (heuristic)', 'soft',
    recs.filter(r => ride(r)?.verdict === 'skip' && !BUSY_OPENING.test(r.oneLiner.split(/[,;.]|\bbut\b|\band\b/)[0] ?? '')).map(r => `${r.ride}: "${r.oneLiner}"`).join(' | ') || null);
  add('now-only', 'No pick tells the guest to wait, come back, or aim for a later time (prod drops these)', 'hard',
    recs.filter(r => COME_BACK.test(r.oneLiner)).map(r => `${r.ride}: "${r.oneLiner}"`).join(' | ') || null);
  return out;
}

// ----------------------------------------------------------------- scenario assert helpers

const nameAt = (recs: ResolvedRec[], n: number) => recs[n - 1]?.ride ?? null;
const rankOf = (recs: ResolvedRec[], ride: string) => recs.findIndex(r => r.ride === ride) + 1;
const capOf = (recs: ResolvedRec[], ride: string) => recs.find(r => r.ride === ride)?.oneLiner ?? null;

export const A = {
  rank1: (ride: string): Assert => ({ id: `rank1:${ride}`, label: `${ride} is rank 1`,
    run: recs => (nameAt(recs, 1) === ride ? null : `rank 1 is ${nameAt(recs, 1) ?? 'nothing'}`) }),
  rank: (ride: string, n: number): Assert => ({ id: `rank${n}:${ride}`, label: `${ride} is rank ${n}`,
    run: recs => (nameAt(recs, n) === ride ? null : `rank ${n} is ${nameAt(recs, n) ?? 'nothing'}`) }),
  rank1Of: (...rides: string[]): Assert => ({ id: `rank1-of:${rides.join("|")}`, label: `rank 1 is one of ${rides.join(", ")}`,
    run: recs => (rides.includes(nameAt(recs, 1) ?? "") ? null : `rank 1 is ${nameAt(recs, 1) ?? "nothing"}`) }),
  notRank1: (ride: string): Assert => ({ id: `not-rank1:${ride}`, label: `${ride} is not rank 1`,
    run: recs => (nameAt(recs, 1) === ride ? `${ride} is rank 1` : null) }),
  absent: (ride: string): Assert => ({ id: `absent:${ride}`, label: `${ride} is not recommended`,
    run: recs => (rankOf(recs, ride) ? `${ride} is rank ${rankOf(recs, ride)}` : null) }),
  last: (ride: string): Assert => ({ id: `last:${ride}`, label: `${ride} is the last pick`,
    run: recs => (rankOf(recs, ride) === recs.length ? null : `${ride} is rank ${rankOf(recs, ride) ?? 'none'} of ${recs.length}`) }),
  present: (ride: string): Assert => ({ id: `present:${ride}`, label: `${ride} is recommended`,
    run: recs => (rankOf(recs, ride) ? null : `${ride} missing`) }),
  below: (ride: string, others: string[]): Assert => ({ id: `below:${ride}`, label: `${ride} ranks below ${others.join(' and ')}`,
    run: recs => {
      const r = rankOf(recs, ride);
      if (!r) return null;
      const above = others.filter(o => { const k = rankOf(recs, o); return !k || k > r; });
      return above.length ? `${ride} at rank ${r} is above ${above.join(', ')}` : null;
    } }),
  captionIf: (ride: string, re: RegExp, label: string): Assert => ({ id: `caption:${ride}:${label}`, label: `If ${ride} is picked, its caption ${label}`,
    run: recs => { const c = capOf(recs, ride); return c == null || re.test(c) ? null : `"${c}"`; } }),
  captionNot: (ride: string, re: RegExp, label: string): Assert => ({ id: `caption-not:${ride}:${label}`, label: `If ${ride} is picked, its caption never ${label}`,
    run: recs => { const c = capOf(recs, ride); return c != null && re.test(c) ? `"${c}"` : null; } }),
  noCaption: (re: RegExp, label: string): Assert => ({ id: `no-caption:${label}`, label: `No caption ${label}`,
    run: recs => recs.find(r => re.test(r.oneLiner))?.oneLiner ?? null }),
  topTwoFrom: (rides: string[]): Assert => ({ id: 'top-two', label: `Ranks 1 and 2 are ${rides.join(' / ')}`,
    run: recs => { const t = recs.slice(0, 2).map(r => r.ride); return t.every(n => n && rides.includes(n)) ? null : `top two: ${t.join(', ')}`; } }),
  either: (label: string, ...opts: Assert[]): Assert => ({ id: `either:${label}`, label,
    run: (recs, b) => { const fails = opts.map(o => o.run(recs, b)); return fails.some(f => f === null) ? null : fails.join(' / '); } }),
  all: (label: string, ...parts: Assert[]): Assert => ({ id: `all:${label}`, label,
    run: (recs, b) => parts.map(p => p.run(recs, b)).find(f => f !== null) ?? null }),
  offered: (ride: string): Assert => ({ id: `offered:${ride}`, label: `${ride} was offered to the model as a candidate`,
    run: () => null }), // evaluated against the variant's offered list in scenarioChecks
};

export function scenarioChecks(recs: ResolvedRec[] | null, b: BuiltFixture, offered: string[]): CheckResult[] {
  return b.fx.asserts.map(a => {
    let fail: string | null;
    if (a.id.startsWith('offered:')) fail = offered.includes(a.id.slice(8)) ? null : `not in the prompt (this prompt version removes it)`;
    else fail = recs ? a.run(recs, b) : 'no parseable answer';
    // Separate "the model chose badly" from "this prompt version never showed the model that ride".
    const ride = b.rides.find(r => a.id.split(':').slice(1).includes(r.name))?.name;
    if (fail && ride && !offered.includes(ride)) fail = `${ride} was never shown to the model by this prompt version (${fail})`;
    // Rank and presence assertions are hard: they say whether the advice was right.
    // Caption-wording assertions (caption:, caption-not:, no-caption:, and the either:/all:
    // combinations built from them) are soft: they are regex stand-ins for judgment, and a
    // caption can give sound advice without matching the words we guessed. The AI judge
    // covers that question. (Tanner, 2026-11-17.)
    const wording = /^(caption:|caption-not:|no-caption:|either:|all:)/.test(a.id);
    return { id: a.id, label: a.label, severity: (wording ? 'soft' : 'hard') as Severity, pass: fail === null, detail: fail ?? undefined, scenario: true };
  });
}

/** A run passes when every hard code check and every scenario assertion passes (spec §13.3: ≥4 of 5 runs). */
export const runPasses = (checks: CheckResult[]) => checks.every(c => c.severity === 'soft' || c.pass);
