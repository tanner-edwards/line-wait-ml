// Builds the authoring packet for an INDEPENDENT author (ChatGPT, Gemini, a person) to write
// held-out scenarios and ideal answers for the recommendation harness. The prompt and most of
// the existing scenarios share an author, so these are the test that can say whether a prompt
// gain is real. The packet gives the product semantics, the ride facts, the fixture shape, and
// real captured pools; it deliberately leaves out the prompt text and the harness's thresholds,
// so the author's judgment is their own.
//
//   npm run holdout-pack                 # writes ~/.claude/specs/line-wait-ml/holdout-authoring-pack.md
//   npm run holdout-pack -- --pools 8    # how many captured pools to include (latest per spot first)
//   npm run holdout-pack -- --out <path>
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { arg, EVALS_ROOT } from './args';
import { Fixture } from './types';
import { START_SPOTS } from './live';
import AGE_APPEAL from '../../app/backend/src/recommendations/ageAppeal.json';

const out = arg('out', join(homedir(), '.claude', 'specs', 'line-wait-ml', 'holdout-authoring-pack.md'))!;
const poolCount = Number(arg('pools', '8'));

interface Meta { name: string; park: string; land: string; height_min_in: number | null; thrill_level: number | null; categories?: string[]; duration_min: number | null; queue_type: string | null; water_ride: boolean; notes: string | null; pregnancy_advisory: boolean; transfer_required: boolean; tracks_wait_time: boolean }
const metaRaw = JSON.parse(readFileSync(join(EVALS_ROOT, '..', 'ride_metadata.json'), 'utf8'));
const META: Meta[] = (Array.isArray(metaRaw) ? metaRaw : Object.values(metaRaw)) as Meta[];
type Appeal = { preschool?: number; gradeSchool?: number; teens?: number; youngAdult?: number; over30?: number };
const APPEAL = (AGE_APPEAL as { rides: Record<string, Appeal> }).rides;

// Latest capture per playbook spot, the default-persona file (the pool is the same for every persona).
const liveDir = join(EVALS_ROOT, 'live');
const files = readdirSync(liveDir).filter(f => /-default\.json$/.test(f)).sort().reverse();
const seen = new Set<string>();
const pools: Fixture[] = [];
for (const f of files) {
  const m = /^LIVE-([a-z-]+)-(.+?)-([a-z]+)-default\.json$/.exec(f);
  if (!m) continue;
  const key = `${m[1]}:${m[3]}`;
  if (seen.has(key)) continue;
  seen.add(key);
  pools.push(JSON.parse(readFileSync(join(liveDir, f), 'utf8')));
  if (pools.length >= poolCount) break;
}

const clock = (hhmm?: string) => { if (!hhmm) return 'unknown'; const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 && h < 24 ? 'PM' : 'AM'}`; };
const n = (v: number | null | undefined, d = '') => (v == null ? d : String(Math.round(v)));
const adults = (a: Appeal) => { const v = [a.youngAdult, a.over30].filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : undefined; };
const f1 = (v: number | undefined) => (v == null ? '-' : v.toFixed(1));

const L: string[] = [];
L.push('# Club 32: write held-out test cases for the ride recommender', '');
L.push('You are being asked to act as an independent test author. Club 32 is a Disneyland Resort companion app. One of its features answers "what should I do next?" with a short ranked list of rides and a one-line reason each. An AI model produces that list from live data and a guest profile. We test the model against frozen scenarios, each with an expected answer. The people who wrote the model\'s instructions also wrote most of the scenarios, so we need test cases from someone who has not seen the instructions. That is you.', '');
L.push('Your job: write **8 to 10 scenarios** in the exact format in section 4, each with the answer a Disney-savvy friend standing next to this party would give. You have everything you need in this file. Do not ask for the model\'s instructions; not seeing them is the point.', '');

L.push('## 1. What a pick is', '');
L.push([
  '- A pick is a ride the guest should walk to **now** and be in line for within about 30 minutes. "Come back later" is never a pick.',
  '- The guest wants the best next move, not a list of current waits. Disney\'s own app shows waits; this feature\'s value is judgment.',
  '- **Saving time is the goal.** A short line that is a long walk away is not a deal if a comparable line is next door. A ride across the park earns the walk only when it still saves clearly more after the walk. Do not send the guest zigzagging.',
  '- The app has already judged each line against its usual for that time of day: `star` (near its best of the day and well under usual), `go` (under usual, or the lowest left today), `neutral` (nothing special either way), `skip` (busy, and a better window is coming). Treat these as evidence, not orders.',
  '- A long line that is clearly dropping within the next half hour is a better bet than its posted wait suggests.',
  '- Near closing, anyone in line at close still rides, so a long wait is not a reason to leave a reachable ride out.',
  '- Just reopened: the posted wait may be behind the real line. Next door it can still lead; across the park, it ranks below a steady option.',
  '- On a bad day (everything above usual), the least bad moves are still picks. The answer is never empty.',
].join('\n'), '');

L.push('## 2. The guest profile and what each field means', '');
L.push([
  '- **youngestAge**: the youngest in the party, or none (all adults). Two things follow from it. Height: a child of typical height for the age cannot ride a ride whose minimum is above their height (typical inches by age: 1: 30, 2: 34, 3: 37, 4: 40, 5: 43, 6: 45, 7: 48, 8: 50, 9: 52, 10: 54, 11: 56, 12: 58, 13+: clears everything). Appeal: the ride facts table carries survey ratings by age group; a ride that the party\'s youngest age group rates poorly (a scare for little ones, a bore for teens and adults) should not lead and should stay out of the top two, unless the party asked for it.',
  '- **ridePreferences**: any of `thrills`, `classics`, `immersive`, `kid-favorites`, `first-time`. Multi-select. A selected category is a **one-step boost, never a filter**: rides in that category rank one step better than they otherwise would, other rides still compete, and a boosted ride with a clearly worse line does not jump past a clearly better one. Selecting everything is the same as selecting nothing. Membership: thrills = thrill 3 or higher; kid-favorites = thrill 1; classics and immersive = the tags in the facts table; first-time = a catch-all that favors the famous (iconic) rides and means the guest does not know the park.',
  '- **watchlist** (the app calls it mustDoRideIds; the guest tapped "Watch" on the ride): a **nudge, not a rank**. It leads only when it is also one of the best deals right now; otherwise it ranks like everything else and only breaks ties.',
  '- **accessibilityNeeds**: `stroller` (walking is slower and costs more), `wheelchair` (avoid rides that require a transfer out of the chair when comparable options exist; walking costs more), `pregnant` (no rides with a pregnancy advisory and nothing with thrill 4 or 5), `sensory` (nothing with thrill 4 or 5).',
  '- A ride someone in the party cannot ride (height, pregnancy, wheelchair, sensory) never leads unless it is on the watchlist. It can still appear lower with a heads-up (rider swap for height).',
  '- **tripDuration**: `1-day`, `2-days`, `3-4-days`, `5-plus-days`. A one-day visit is the only chance at the big rides.',
  '- **ridden**: a ride the party marked "Rode it" this trip is removed from the pool before the model sees it. The app has no other way to know what they have ridden.',
].join('\n'), '');

L.push('## 3. Ride facts', '');
L.push('Every ride the app knows, with the facts the model sees. Appeal is the TouringPlans reader-survey rating (0 to 5) by age group: pre = preschool (under 7), grade = grade school (7 to 9; 10 to 12 sits between grade and teen), teen (13 to 17), adult. A dash means no survey data.', '');
L.push('| ride | park | land | min height | thrill | tags | ride min | queue | wet | pre | grade | teen | adult | notes |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const m of META.filter(x => x.tracks_wait_time !== false).sort((a, b) => a.park.localeCompare(b.park) || a.land.localeCompare(b.land) || a.name.localeCompare(b.name))) {
  const a = APPEAL[m.name] ?? {};
  L.push(`| ${m.name} | ${m.park.replace("Disney California Adventure", 'DCA').replace('Disneyland', 'DL')} | ${m.land} | ${m.height_min_in ?? '-'} | ${m.thrill_level ?? '-'} | ${(m.categories ?? []).join('/') || '-'} | ${m.duration_min ?? '-'} | ${m.queue_type ?? '-'} | ${m.water_ride ? 'yes' : '-'} | ${f1(a.preschool)} | ${f1(a.gradeSchool)} | ${f1(a.teens)} | ${f1(adults(a))} | ${(m.notes ?? '').replace(/\|/g, '/')}${m.pregnancy_advisory ? '; pregnancy advisory' : ''}${m.transfer_required ? '; wheelchair transfer required' : ''} |`);
}
L.push('');

L.push('## 4. The format: copy it exactly', '');
L.push('Each scenario is one block like this. Keep the field names and the table columns exactly as shown; a script reads them. Ride names must match the facts table exactly.', '');
L.push('```', '### Scenario <your-name>-1: <short title>', 'tests: <one line: what trap this scenario sets and why the obvious answer is wrong>', 'park: disneyland', 'time: Saturday 2:00 PM', 'closes: 11:00 PM', 'party: youngest 6 | preferences: thrills, classics | watchlist: Pirates of the Caribbean | needs: stroller | trip: 1-day', 'standing at: Mad Tea Party', 'rides:', '| ride | wait | usual | walk | verdict | trend | note |', '|---|---|---|---|---|---|---|', '| Mad Tea Party | 10 | 10 | 0 | neutral | flat | |', '| Peter Pan\'s Flight | 30 | 50 | 2 | go | flat | |', '| Big Thunder Mountain Railroad | 40 | 35 | 6 | neutral | falling to 25 in 30 min | |', '| Indiana Jones Adventure | 20 | 50 | 12 | star | flat | reopened 10 min ago |', 'expect:', '- top two from: Peter Pan\'s Flight, Big Thunder Mountain Railroad', '- must not lead: Indiana Jones Adventure', '- must appear: Big Thunder Mountain Railroad', '- must not appear: (optional)', 'why: <one or two sentences, the way a friend would say it>', '```', '');
L.push([
  'Field notes:',
  '- `party`: `youngest` is an age or `adults`. `preferences`, `watchlist`, `needs` may be `none`. `trip` may be omitted.',
  '- `wait` is the posted minutes now; `usual` is the normal line for this time of day on this kind of day; `walk` is minutes from where the party stands (the standing-at ride is 0). `verdict` is one of star, go, neutral, skip. `trend` is flat, rising, or "falling to N in 30 min". `note` is empty, `reopened N min ago`, or `ridden`.',
  '- Anything you leave out, the harness fills with a neutral default. Five to eight rides per scenario is plenty.',
  '- `expect` lines are the assertions. Use only the four shown. `top two from` is the strongest; use it when you are sure. Every scenario needs at least one `must not lead` or `top two from`.',
  '- Write the trap first, then the numbers. A good scenario has an obvious wrong answer: the star across the park, the walk-on that bores a teen, the watchlist ride at a normal line, the ride the toddler cannot ride.',
].join('\n'), '');

L.push('## 5. Coverage to aim for', '');
L.push([
  'Spread your scenarios across these, at least one each:',
  '1. Walk versus deal: a short line far away against a comparable line close by.',
  '2. A great deal that is worth the walk.',
  '3. Preference boost with a cost: the boosted ride is a little worse on the line.',
  '4. Age fit: a youngest age for whom the easy walk-ons are wrong (a teen) or the thrill rides are wrong (under 7).',
  '5. Watchlist as a nudge: a watched ride at a normal line versus an unwatched ride under usual.',
  '6. A restriction: pregnancy, wheelchair, or a toddler and a height minimum.',
  '7. Near closing with a long line that is falling.',
  '8. A bad day where everything is above usual.',
  '9. Just reopened across the park.',
  '10. A multi-select preference (two categories) or everything selected.',
].join('\n'), '');

L.push('## 6. Real pools you can build from', '');
L.push(`These are real captures from the app's backend (${pools.length} pools, one per starting spot). The party was not set, so there are no restrictions in them; add a party of your own and edit any number you need to set the trap. Walk is from the spot named.`, '');
for (const p of pools) {
  const spotKey = /-([a-z]+)-default$/.exec(p.id)?.[1] ?? '?';
  const spot = (START_SPOTS as Record<string, Record<string, string>>)[p.park]?.[spotKey] ?? spotKey;
  L.push(`### Pool: ${p.park}, ${p.localTime}, closes ${clock(p.hours?.close)}, standing at ${spot} (${p.anchor.name})`, '');
  if (p.weather) L.push(`Weather: ${p.weather.tempF}F, ${p.weather.conditions}.`, '');
  L.push('| ride | wait | usual | walk | verdict | trend | note |', '|---|---|---|---|---|---|---|');
  const rides = [p.anchor, ...p.rides].sort((a, b) => a.walk - b.walk || a.name.localeCompare(b.name));
  for (const r of rides) {
    const b30 = r.buckets?.[1];
    const trend = b30 == null ? 'flat' : b30 <= r.wait - 10 ? `falling to ${n(b30)} in 30 min` : b30 >= r.wait + 10 ? `rising to ${n(b30)} in 30 min` : 'flat';
    const note = r.minutesSinceReopen != null && r.minutesSinceReopen <= 60 ? `reopened ${r.minutesSinceReopen} min ago` : '';
    L.push(`| ${r.name} | ${n(r.wait)} | ${n(r.usual, '-')} | ${n(r.walk)} | ${r.verdict} | ${trend} | ${note} |`);
  }
  L.push('');
}

L.push('## 7. What to send back', '');
L.push('One markdown file with your 8 to 10 scenario blocks, nothing else in it. Put your name in each scenario id. If a fact in this packet looks wrong to you (a thrill level, a tag, an appeal rating), say so at the top of the file instead of working around it; that is useful too.', '');

writeFileSync(out, L.join('\n'));
console.log(`Wrote ${out} (${L.join('\n').length.toLocaleString()} chars, ${pools.length} pools)`);
