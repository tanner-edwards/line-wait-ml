// Scenarios from the spec "AI Recommendation Expectations" (2026-11-16), section 11.
// Values the spec states are used as-is. Every value the spec does NOT state is listed in that
// fixture's `filled` array so Tanner can confirm or correct it (never adjusted silently).
// Static ride facts (height, thrill, pregnancy advisory, ids) come from ride_metadata.json.
//
// `ideal` answers adapt the 2026-11-16 draft's target captions to the final spec's rules (for
// example skip picks open with busy-day framing; a reopened ride warns the line may be longer).
// They must pass every code check (verified by `npm run dry-run`). `bad` answers must fail.

import { A } from '../checks';
import { Fixture, RideFact } from '../types';

const BUZZ: RideFact = { name: 'Buzz Lightyear Astro Blasters', wait: 25, usual: 30, verdict: 'neutral', reason: 'none', walk: 0 };
const BUZZ_NOTE = 'Anchor Buzz Lightyear: wait 25, usual 30, neutral (spec section 6.13 example values)';
const SAT = (h: number, m: number) => h * 60 + m;
const DL_HOURS = { open: '08:00', close: '23:00' };

const PREGNANT_RE = /(pregnan|expecting|sit (this|it) out|sits (this|it) out|one of you)/i;
const WONT_SHORTER = /(won't|will not|isn't going to|not going to) (get )?(any )?(shorter|better|improve)|stays? (long|high|busy|that way)|all (day|afternoon)/i;

export const FIXTURES: Fixture[] = [
  // ------------------------------------------------------------------ S1
  {
    id: 'S1', title: 'Pregnant guest, rough star ride',
    tests: 'A star verdict does not win by default; restrictions are a ranking factor and an answered objection.',
    park: 'disneyland', localTime: 'Saturday 1:30 PM', nowMin: SAT(13, 30), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 18, ridePreferences: ['thrills'], mustDoRideIds: [], accessibilityNeeds: ['pregnant'] },
    anchor: BUZZ,
    rides: [
      { name: 'Indiana Jones Adventure', wait: 30, usual: 55, verdict: 'star', reason: 'rare-low', walk: 9 },
      { name: 'Pirates of the Caribbean', wait: 15, usual: 30, verdict: 'go', reason: 'below-usual', walk: 10 },
      { name: 'Jungle Cruise', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 9 },
      { name: 'Haunted Mansion', wait: 25, usual: 25, verdict: 'neutral', reason: 'none', walk: 11 },
      { name: 'Big Thunder Mountain Railroad', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
    ],
    weather: { tempF: 75, feelsF: 75, conditions: 'clear' },
    filled: [BUZZ_NOTE, 'Walk times: Indy 9, Pirates 10, Jungle Cruise 9, Haunted Mansion 11, Big Thunder 12', 'Big Thunder usual 35', 'Party as persona: youngestAge 18 (two adults), ride preference thrills', 'Hours 8:00 AM to 11:00 PM', 'Weather 75F clear', 'Forecasts flat at the current wait'],
    asserts: [A.rank1('Pirates of the Caribbean'), A.notRank1('Indiana Jones Adventure')],
    expectation: 'Rank 1 is Pirates. Indiana Jones is not rank 1. Indiana Jones and Big Thunder carry a pregnancy restriction note if ranked at all. The rank 1 caption may name Indiana Jones as the answered objection.',
    ideal: [
      { ride: 'Pirates of the Caribbean', caption: 'Half its usual line, and nobody in your group has to sit it out.' },
      { ride: 'Jungle Cruise', caption: 'Gentle, and a shorter line than it usually has.' },
      { ride: 'Haunted Mansion', caption: "Calm and indoors, with a line that's about normal." },
    ],
    bad: [
      { ride: 'Indiana Jones Adventure', caption: 'A rare short line on a top thrill ride, go now.' },
      { ride: 'Pirates of the Caribbean', caption: 'Pirates is half its usual line.' },
    ],
  },
  {
    id: 'S1v', title: 'Pregnant guest, Indiana Jones wanted',
    tests: 'A wanted ride is assumed to have a plan: the restriction is a caption flag, not a penalty.',
    park: 'disneyland', localTime: 'Saturday 1:30 PM', nowMin: SAT(13, 30), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 18, ridePreferences: ['thrills'], mustDoRideIds: [], accessibilityNeeds: ['pregnant'] },
    anchor: BUZZ,
    rides: [
      { name: 'Indiana Jones Adventure', wait: 30, usual: 55, verdict: 'star', reason: 'rare-low', walk: 9, wanted: true },
      { name: 'Pirates of the Caribbean', wait: 15, usual: 30, verdict: 'go', reason: 'below-usual', walk: 10 },
      { name: 'Jungle Cruise', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 9 },
      { name: 'Haunted Mansion', wait: 25, usual: 25, verdict: 'neutral', reason: 'none', walk: 11 },
      { name: 'Big Thunder Mountain Railroad', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
    ],
    filled: ['Same as S1, with Indiana Jones wanted'],
    asserts: [A.captionIf('Indiana Jones Adventure', PREGNANT_RE, 'flags that one guest sits it out')],
    expectation: 'Indiana Jones may lead. If picked, its caption flags that one guest sits this one out.',
    ideal: [
      { ride: 'Indiana Jones Adventure', caption: 'About half its usual line, though one of you will sit this one out.', note: 'Not advised during pregnancy.' },
      { ride: 'Pirates of the Caribbean', caption: 'Half its usual line, and an easy ride for everyone.' },
      { ride: 'Jungle Cruise', caption: 'Gentle, and a shorter line than it usually has.' },
    ],
    bad: [{ ride: 'Indiana Jones Adventure', caption: 'About half its usual line, a great time to go.' }],
  },
  // ------------------------------------------------------------------ S2
  {
    id: 'S2', title: 'Toddler and stroller, height-restricted star',
    tests: 'Height data comes from the input; a restriction is not a ban; the walk with a stroller is a real cost.',
    park: 'disneyland', localTime: 'Saturday 11:00 AM', nowMin: SAT(11, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 3, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: ['stroller'] },
    anchor: { name: 'Mad Tea Party', wait: 15, usual: 15, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Star Wars: Rise of the Resistance', wait: 40, usual: 75, verdict: 'star', reason: 'rare-low', walk: 14 },
      { name: 'Big Thunder Mountain Railroad', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: "Peter Pan's Flight", wait: 25, usual: 50, verdict: 'go', reason: 'below-usual', walk: 4 },
      { name: 'Dumbo the Flying Elephant', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 3 },
      { name: 'Storybook Land Canal Boats', wait: 15, usual: 25, verdict: 'neutral', reason: 'none', walk: 5 },
    ],
    filled: ['Anchor Mad Tea Party: wait 15, usual 15, neutral', 'Big Thunder usual 35', 'Hours 8:00 AM to 11:00 PM', 'Forecasts flat'],
    asserts: [A.rank1("Peter Pan's Flight"), A.notRank1('Star Wars: Rise of the Resistance')],
    expectation: "Rank 1 is Peter Pan's Flight. Rise of the Resistance is not rank 1; it is restricted for the toddler (40 in. minimum) and its note says so if listed.",
    ideal: [
      { ride: "Peter Pan's Flight", caption: 'Half its usual line, and an easy walk with the stroller.' },
      { ride: 'Dumbo the Flying Elephant', caption: 'Under its usual line, and toddlers love it.' },
      { ride: 'Storybook Land Canal Boats', caption: 'Calm and close, a good reset for tired little ones.' },
    ],
    bad: [{ ride: 'Star Wars: Rise of the Resistance', caption: "A rare short line on the park's biggest ride." }],
  },
  {
    id: 'S2A', title: 'Toddler, Rise of the Resistance wanted (wait 40)',
    tests: 'A wanted restricted ride may lead; the caption mentions rider swap.',
    park: 'disneyland', localTime: 'Saturday 11:00 AM', nowMin: SAT(11, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 3, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: ['stroller'] },
    anchor: { name: 'Mad Tea Party', wait: 15, usual: 15, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Star Wars: Rise of the Resistance', wait: 40, usual: 75, verdict: 'star', reason: 'rare-low', walk: 14, wanted: true },
      { name: 'Big Thunder Mountain Railroad', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: "Peter Pan's Flight", wait: 25, usual: 50, verdict: 'go', reason: 'below-usual', walk: 4 },
      { name: 'Dumbo the Flying Elephant', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 3 },
      { name: 'Storybook Land Canal Boats', wait: 15, usual: 25, verdict: 'neutral', reason: 'none', walk: 5 },
    ],
    filled: ['Same as S2, with Rise of the Resistance wanted'],
    asserts: [A.captionIf('Star Wars: Rise of the Resistance', /swap/i, 'mentions rider swap')],
    expectation: 'Rise of the Resistance may lead. If picked, its caption mentions rider swap.',
    ideal: [
      { ride: 'Star Wars: Rise of the Resistance', caption: 'Close to half its usual line, so plan a rider swap for your toddler.', note: 'Your toddler is under the 40-inch minimum.' },
      { ride: "Peter Pan's Flight", caption: 'Half its usual line, and an easy ride for your toddler.' },
      { ride: 'Dumbo the Flying Elephant', caption: 'Under its usual line, and toddlers love it.' },
    ],
    bad: [{ ride: 'Star Wars: Rise of the Resistance', caption: "You still want this one, and it's close to half its usual line." }],
  },
  {
    id: 'S2B', title: 'Toddler, Rise of the Resistance at a third of usual (not wanted)',
    tests: 'Party fit beats window strength: an unwanted ride the toddler cannot ride does not lead, even at a third of its usual line (decision 2026-11-17).',
    park: 'disneyland', localTime: 'Saturday 11:00 AM', nowMin: SAT(11, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 3, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: ['stroller'] },
    anchor: { name: 'Mad Tea Party', wait: 15, usual: 15, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Star Wars: Rise of the Resistance', wait: 25, usual: 75, verdict: 'star', reason: 'rare-low', walk: 14 },
      { name: 'Big Thunder Mountain Railroad', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: "Peter Pan's Flight", wait: 25, usual: 50, verdict: 'go', reason: 'below-usual', walk: 4 },
      { name: 'Dumbo the Flying Elephant', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 3 },
      { name: 'Storybook Land Canal Boats', wait: 15, usual: 25, verdict: 'neutral', reason: 'none', walk: 5 },
    ],
    filled: ['Same as S2, with Rise of the Resistance at 25 and not wanted', 'Decision 2026-11-17 (Tanner): party fit wins over window strength, replacing the spec\'s "Rise is rank 1 even unwanted"'],
    asserts: [
      A.notRank1('Star Wars: Rise of the Resistance'),
      A.either('A ride the toddler can ride leads', A.rank1("Peter Pan's Flight"), A.rank1('Dumbo the Flying Elephant'), A.rank1('Storybook Land Canal Boats')),
    ],
    expectation: 'Party fit wins: a ride the toddler can ride leads (Peter Pan, Dumbo or Storybook). Rise of the Resistance may appear lower, with its restriction noted and rider swap mentioned; "rarely this short" is allowed for it because it is far below usual.',
    ideal: [
      { ride: "Peter Pan's Flight", caption: 'Half its usual line, and an easy ride for your toddler.' },
      { ride: 'Star Wars: Rise of the Resistance', caption: "A third of its usual line and it's rarely this short; plan a rider swap.", note: 'Your toddler is under the 40-inch minimum.' },
      { ride: 'Dumbo the Flying Elephant', caption: 'Under its usual line, and toddlers love it.' },
    ],
    bad: [
      { ride: 'Star Wars: Rise of the Resistance', caption: "A third of its usual line and it's rarely this short; plan a rider swap.", note: 'Your toddler is under the 40-inch minimum.' },
      { ride: "Peter Pan's Flight", caption: 'Half its usual line, and an easy ride for your toddler.' },
    ],
  },
  // ------------------------------------------------------------------ S3
  {
    id: 'S3', title: 'Flat field',
    tests: 'No invented window; lead with the real tiebreaker (walk, or something they want).',
    park: 'disneyland', localTime: 'Saturday 2:00 PM', nowMin: SAT(14, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 8, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Mark Twain Riverboat', wait: 10, usual: 10, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Big Thunder Mountain Railroad', wait: 30, usual: 35, verdict: 'neutral', reason: 'trivial-drop', walk: 2 },
      { name: 'Pirates of the Caribbean', wait: 25, usual: 30, verdict: 'neutral', reason: 'trivial-drop', walk: 4, wanted: true },
      { name: 'Space Mountain', wait: 40, usual: 45, verdict: 'neutral', reason: 'trivial-drop', walk: 12 },
    ],
    filled: ['Anchor Mark Twain Riverboat: wait 10, usual 10, neutral (its real feed posts no wait)', 'Verdicts neutral / trivial-drop for all three', 'Party: two adults, kids 8 and 10 (youngestAge 8)', 'Hours 8:00 AM to 11:00 PM', 'Forecasts flat'],
    asserts: [
      A.noCaption(/\b(rare|rarely|great deal|best window)\b/i, 'says "rare", "great deal" or "best window"'),
      A.topTwoFrom(['Pirates of the Caribbean', 'Big Thunder Mountain Railroad']),
      A.below('Space Mountain', ['Pirates of the Caribbean', 'Big Thunder Mountain Railroad']),
    ],
    expectation: 'No caption uses "rare", "great deal" or "best window". Ranks 1 and 2 are Pirates (wanted) and Big Thunder (closest), in either order. Space Mountain ranks below both.',
    ideal: [
      { ride: 'Big Thunder Mountain Railroad', caption: 'The shortest walk, and lines everywhere are a bit under usual.' },
      { ride: 'Pirates of the Caribbean', caption: 'You wanted this one, and its line is a bit under usual.' },
      { ride: 'Space Mountain', caption: 'A popular thrill ride with a line a bit under usual.' },
    ],
    bad: [{ ride: 'Space Mountain', caption: 'A rare chance at a great deal on a headliner.' }],
  },
  // ------------------------------------------------------------------ S4
  {
    id: 'S4', title: 'Bad field, wanted ride high and staying high',
    tests: 'Honest framing; a wanted ride with a weak window is not oversold; always at least one recommendation.',
    park: 'disneyland', localTime: 'Saturday 12:30 PM', nowMin: SAT(12, 30), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 6, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Mad Tea Party', wait: 40, usual: 25, verdict: 'skip', reason: 'busy-no-relief', walk: 0 },
    rides: [
      { name: 'Matterhorn Bobsleds', wait: 40, usual: 35, verdict: 'neutral', reason: 'none', walk: 6 },
      { name: 'Dumbo the Flying Elephant', wait: 45, usual: 30, verdict: 'skip', reason: 'busy-no-relief', walk: 3 },
      { name: "Peter Pan's Flight", wait: 75, usual: 50, verdict: 'skip', reason: 'busy-no-relief', walk: 3, wanted: true, buckets: [75, 72, 70, 70, 70, 70] },
      { name: 'Space Mountain', wait: 80, usual: 45, verdict: 'skip', reason: 'busy-no-relief', walk: 10 },
    ],
    filled: ['Anchor Mad Tea Party: wait 40, usual 25, skip', 'Walk: Matterhorn 6, Dumbo 3, Peter Pan 3, Space 10 (from the draft)', 'Party: two adults, kids 6 and 9 (youngestAge 6)', 'Verdict reasons busy-no-relief', 'Hours 8:00 AM to 11:00 PM', 'Peter Pan forecast 75, 72, 70, 70, 70, 70; others flat'],
    asserts: [
      A.present("Peter Pan's Flight"),
      A.captionIf("Peter Pan's Flight", WONT_SHORTER, "says honestly it won't get shorter"),
    ],
    expectation: "At least one recommendation. Every skip-verdict pick's caption opens with busy-day framing (first clause). Peter Pan's Flight appears with honest copy (you wanted this and it won't get shorter), never positive-timing words. Space Mountain may be omitted.",
    ideal: [
      { ride: 'Matterhorn Bobsleds', caption: "Everything's busy today, and this line is closest to normal." },
      { ride: 'Dumbo the Flying Elephant', caption: 'Lines are long everywhere, and this one is a short walk for the kids.' },
      { ride: "Peter Pan's Flight", caption: "You wanted this one, and it won't get shorter this afternoon." },
    ],
    bad: [{ ride: "Peter Pan's Flight", caption: 'Great time to ride, the line is moving fast.' }],
  },
  // ------------------------------------------------------------------ S5
  {
    id: 'S5', title: 'Wanted ride with a skip verdict, line staying high',
    tests: 'A skip verdict never silently drops a wanted ride; the forecast drives go-or-wait.',
    park: 'disneyland', localTime: 'Saturday 4:00 PM', nowMin: SAT(16, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 9, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: BUZZ,
    rides: [
      { name: 'Space Mountain', wait: 55, usual: 40, verdict: 'skip', reason: 'busy-no-relief', walk: 3, wanted: true, buckets: [55, 57, 58, 60, 58, 57] },
      { name: 'Matterhorn Bobsleds', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: 'Big Thunder Mountain Railroad', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
    ],
    filled: [BUZZ_NOTE, 'Party: two adults, kids 9 and 12 (youngestAge 9)', 'Space forecast 55, 57, 58, 60, 58, 57; others flat'],
    asserts: [A.either('Space leads saying it won\'t get shorter, or Matterhorn leads and names Space as the tradeoff',
      A.all('Space leads', A.rank1('Space Mountain'), A.captionIf('Space Mountain', WONT_SHORTER, "says it won't get shorter")),
      A.all('Matterhorn leads', A.rank1('Matterhorn Bobsleds'), A.captionIf('Matterhorn Bobsleds', /Space/, 'names Space Mountain')))],
    expectation: 'Either Space Mountain leads with "won\'t get shorter today" framing, or Matterhorn leads and its caption names Space Mountain as the tradeoff.',
    ideal: [
      { ride: 'Space Mountain', caption: "You still want this one, and it won't get shorter today." },
      { ride: 'Matterhorn Bobsleds', caption: 'About 15 minutes shorter than usual, a good one to add.' },
      { ride: 'Big Thunder Mountain Railroad', caption: 'A bit under its usual line, if you want another thrill.' },
    ],
    bad: [
      { ride: 'Big Thunder Mountain Railroad', caption: 'A bit under its usual line.' },
      { ride: 'Space Mountain', caption: 'Great time for this one.' },
    ],
  },
  {
    id: 'S5v', title: 'Wanted skip ride, line falls within the hour',
    tests: 'Present tense: do the good deal now; the later drop is the reason, cited on the pick you do now.',
    park: 'disneyland', localTime: 'Saturday 4:00 PM', nowMin: SAT(16, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 9, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: BUZZ,
    rides: [
      { name: 'Space Mountain', wait: 55, usual: 40, verdict: 'skip', reason: 'dropping-soon', walk: 3, wanted: true, buckets: [55, 45, 40, 40, 40, 40], window: { wait: 40, inMin: 60 } },
      { name: 'Matterhorn Bobsleds', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: 'Big Thunder Mountain Railroad', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
    ],
    filled: ['Same as S5; Space forecast 55, 45, 40, 40, 40, 40 with a best window of 40 in 60 minutes'],
    asserts: [
      A.rank1('Matterhorn Bobsleds'),
      A.captionIf('Matterhorn Bobsleds', /Space[\s\S]*(drop|down|shorter|fall|ease|settle|better)|(drop|down|shorter|fall|ease|settle|better)[\s\S]*Space/i, 'says Space Mountain drops soon'),
      A.notRank1('Space Mountain'),
      A.captionNot('Space Mountain', /\b(come back|swing back|head back|return|later|in an hour|after)\b/i, 'tells the guest to come back later'),
    ],
    expectation: 'Matterhorn is rank 1 and its caption says Space Mountain drops within the hour. Space Mountain, if listed, is not rank 1 and its own caption does not say "come back later" (that reason lives on Matterhorn\'s caption).',
    ideal: [
      { ride: 'Matterhorn Bobsleds', caption: "Ride this now while Space Mountain's line drops over the next hour." },
      { ride: 'Big Thunder Mountain Railroad', caption: 'A bit under its usual line, and a good second thrill.' },
    ],
    bad: [{ ride: 'Space Mountain', caption: 'Come back in an hour when the line drops to 40.' }],
  },
  // ------------------------------------------------------------------ S6
  {
    id: 'S6', title: 'Closing hour',
    tests: 'A guest in line at close still rides; a long line that is falling is a better bet than it looks.',
    park: 'disneyland', localTime: 'Saturday 10:10 PM', nowMin: SAT(22, 10), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 15, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Pirates of the Caribbean', wait: 20, usual: 20, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Haunted Mansion', wait: 15, usual: 25, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: 'Space Mountain', wait: 60, usual: 45, verdict: 'neutral', reason: 'none', walk: 14, buckets: [60, 45, 40, 40, 40, 40] },
      { name: 'Big Thunder Mountain Railroad', wait: 40, usual: 35, verdict: 'neutral', reason: 'none', walk: 6, buckets: [40, 25, 25, 25, 25, 25] },
      { name: 'Matterhorn Bobsleds', wait: 30, usual: 35, verdict: 'go', reason: 'below-usual', walk: 10 },
    ],
    weather: { tempF: 62, feelsF: 62, conditions: 'clear' },
    filled: ['Anchor Pirates: wait 20, usual 20, neutral', 'Party: two adults and a 15-year-old (youngestAge 15)', 'Space forecast 60, 45, 40, 40, 40, 40 (spec: about 40 by 10:50)', 'Big Thunder forecast 40, 25, 25... (spec: about 25 within 30 minutes)', 'Weather 62F clear'],
    asserts: [
      A.rank1('Haunted Mansion'),
      A.present('Space Mountain'),
      A.captionIf('Space Mountain', /(clos|in line|before (the )?(park|end))/i, 'says being in line before close still rides'),
    ],
    expectation: 'Every pick is reachable before close. Haunted Mansion is rank 1. Space Mountain is present and its caption says in line before close still rides. Big Thunder may cite its 30-minute drop as a reason it is a good bet.',
    ideal: [
      { ride: 'Haunted Mansion', caption: 'Quick line now, and you can still line up for Space Mountain after.' },
      { ride: 'Space Mountain', caption: "In line before close means you still ride, and the wait's falling." },
      { ride: 'Big Thunder Mountain Railroad', caption: "Longer than usual now, but it's dropping within the half hour." },
    ],
    bad: [
      { ride: 'Space Mountain', caption: 'The last big ride of the night, go now.' },
      { ride: 'Haunted Mansion', caption: 'Quick line now.' },
    ],
  },
  // ------------------------------------------------------------------ S7
  {
    id: 'S7', title: 'Reopened ride next door (20 minutes ago)',
    tests: 'Trust scales with how cheap it is to check: a 1-minute walk can still lead, with a warning.',
    park: 'disneyland', localTime: 'Saturday 11:30 AM', nowMin: SAT(11, 30), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 10, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: BUZZ,
    rides: [
      { name: 'Space Mountain', wait: 15, usual: 45, verdict: 'star', reason: 'rare-low', walk: 1, minutesSinceReopen: 20, buckets: [15, 25, 35, 38, 40, 40] },
      { name: 'Matterhorn Bobsleds', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: 'Big Thunder Mountain Railroad', wait: 30, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
    ],
    filled: [BUZZ_NOTE, 'Party: two adults, kids 10 and 12 (youngestAge 10)', 'Space forecast 15, 25, 35, 38, 40, 40 (spec 6.13 example)'],
    asserts: [
      A.rank1('Space Mountain'),
      A.captionIf('Space Mountain', /((real|actual) line|longer than (posted|it looks|shown)|posted|just reopened|reopened)/i, 'warns the real line may be longer'),
    ],
    expectation: 'Space Mountain is rank 1; its caption does not say "rare" or "great deal" and warns the real line may be longer than posted.',
    ideal: [
      { ride: 'Space Mountain', caption: 'Right next door, but it just reopened, so the real line may be longer.' },
      { ride: 'Matterhorn Bobsleds', caption: 'A steady line, and a safe fallback if Space Mountain jumps.' },
      { ride: 'Big Thunder Mountain Railroad', caption: "A bit under its usual line, and it's holding steady." },
    ],
    bad: [{ ride: 'Space Mountain', caption: 'A rare chance at a great deal right next door.' }],
  },
  {
    id: 'S7v', title: 'Reopened ride next door (5 minutes ago)',
    tests: 'A ride that just reopened with a low wait, a minute away, is a go-now pick (decision 2026-11-17).',
    park: 'disneyland', localTime: 'Saturday 11:30 AM', nowMin: SAT(11, 30), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 10, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: BUZZ,
    rides: [
      { name: 'Space Mountain', wait: 15, usual: 45, verdict: 'star', reason: 'rare-low', walk: 1, minutesSinceReopen: 5, buckets: [15, 25, 35, 38, 40, 40] },
      { name: 'Matterhorn Bobsleds', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: 'Big Thunder Mountain Railroad', wait: 30, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
    ],
    filled: ['Same as S7 with minutesSinceReopen 5', 'Decision 2026-11-17 (Tanner): "if the ride opened 5 minutes ago and has a low wait, go there quickly", replacing the spec\'s Matterhorn-first ruling'],
    asserts: [
      A.rank1('Space Mountain'),
      A.captionIf('Space Mountain', /(re-?opened|back (open|up|running)|just opened)/i, 'says it just reopened'),
    ],
    expectation: 'Space Mountain is rank 1: it just reopened, the line is short and it is a minute away, so go now before the line refills. Its caption says it just reopened and never calls it "rare" or "a great deal".',
    ideal: [
      { ride: 'Space Mountain', caption: 'It just reopened and the line is short, so head over now.' },
      { ride: 'Matterhorn Bobsleds', caption: 'A steady line, and a safe fallback if Space Mountain fills up.' },
      { ride: 'Big Thunder Mountain Railroad', caption: "A bit under its usual line, and it's holding steady." },
    ],
    bad: [
      { ride: 'Matterhorn Bobsleds', caption: "A steady line, and a safe pick while Space Mountain's wait settles." },
      { ride: 'Space Mountain', caption: 'Just reopened, so check the real line before you commit.' },
    ],
  },
  // ------------------------------------------------------------------ S8
  {
    id: 'S8', title: 'Radiator Springs, the production incident',
    tests: 'No arithmetic by the model; a later window is never presented as the reason to go now.',
    park: 'california-adventure', localTime: 'Tuesday 3:39 PM', nowMin: SAT(15, 39), hours: { open: '08:00', close: '21:00' },
    persona: null,
    anchor: { name: 'WEB SLINGERS: A Spider-Man Adventure', wait: 60, usual: 50, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Radiator Springs Racers', wait: 130, usual: 125, p90: 140, verdict: 'neutral', reason: 'none', walk: 2, buckets: [130, 115, 111, 110, 112, 115], window: { wait: 95, inMin: 261 } },
      { name: 'Incredicoaster', wait: 75, usual: 55, verdict: 'skip', reason: 'busy-no-relief', walk: 9 },
      { name: 'Guardians of the Galaxy – Mission: BREAKOUT!', wait: 70, usual: 50, verdict: 'skip', reason: 'busy-no-relief', walk: 3 },
      { name: "Soarin' Around the World", wait: 65, usual: 45, verdict: 'skip', reason: 'busy-no-relief', walk: 6 },
      { name: 'Toy Story Midway Mania!', wait: 70, usual: 45, verdict: 'skip', reason: 'busy-no-relief', walk: 8 },
      { name: 'Monsters, Inc. Mike & Sulley to the Rescue!', wait: 40, usual: 30, verdict: 'neutral', reason: 'none', walk: 4 },
      { name: 'Grizzly River Run', wait: 45, usual: 35, verdict: 'neutral', reason: 'none', walk: 7 },
    ],
    weather: { tempF: 84, feelsF: 86, conditions: 'clear' },
    filled: ['DCA field (spec: "a realistic DCA field where everything is above usual"): Incredicoaster 75/55 skip walk 9, Guardians 70/50 skip walk 3, Soarin 65/45 skip walk 6, Toy Story 70/45 skip walk 8, Monsters Inc 40/30 neutral walk 4, Grizzly 45/35 neutral walk 7', 'Anchor WEB SLINGERS: wait 60, usual 50, neutral', 'DCA hours 8:00 AM to 9:00 PM', 'Persona: none (default persona)', 'Radiator Springs window 95 at 8:00 PM = 261 minutes from 3:39 PM', 'Weather 84F, feels 86, clear'],
    asserts: [
      A.captionNot('Radiator Springs Racers', /(\d{1,2}(:\d\d)?\s*(am|pm)\b|\blater\b|tonight|this evening|\bhours?\b|drops? to)/i, 'names a later time or future wait as its reason'),
      A.noCaption(/1\.5/, 'contains "1.5"'),
    ],
    expectation: "If Radiator Springs is picked, its caption never names a later time or a future wait as the reason; it reads as least-bad (busy day). A caption that mentions Radiator Springs' evening drop does so only as a reason to do another ride now. No caption contains 1.5 or a wait that is not in the data.",
    ideal: [
      { ride: 'Radiator Springs Racers', caption: "Busy everywhere today, and this line is holding near its normal." },
      { ride: 'Monsters, Inc. Mike & Sulley to the Rescue!', caption: 'Lines are long today, and this short walk is the easiest win.' },
      { ride: 'Grizzly River Run', caption: 'Longer than usual, but one of the lighter lines right now.' },
    ],
    bad: [{ ride: 'Radiator Springs Racers', caption: 'Wait will drop to ~95 min in 1.5 hours.' }],
  },
  // ------------------------------------------------------------------ S9
  {
    id: 'S9', title: 'Anchor ride is a good pick',
    tests: 'The ride the guest is standing at is a candidate, not silently removed.',
    park: 'disneyland', localTime: 'Saturday 2:00 PM', nowMin: SAT(14, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 18, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Haunted Mansion', wait: 20, usual: 40, verdict: 'go', reason: 'below-usual', walk: 0 },
    rides: [
      { name: 'Pirates of the Caribbean', wait: 30, usual: 30, verdict: 'neutral', reason: 'none', walk: 2 },
      { name: 'Jungle Cruise', wait: 35, usual: 35, verdict: 'neutral', reason: 'none', walk: 4 },
      { name: 'Indiana Jones Adventure', wait: 50, usual: 55, verdict: 'neutral', reason: 'trivial-drop', walk: 4 },
      { name: 'Big Thunder Mountain Railroad', wait: 35, usual: 40, verdict: 'neutral', reason: 'trivial-drop', walk: 6 },
    ],
    filled: ['Local time Saturday 2:00 PM', 'Party: two adults (youngestAge 18)', 'Other rides: Pirates 30/30, Jungle Cruise 35/35, Indy 50/55, Big Thunder 35/40, all neutral', 'Hours 8:00 AM to 11:00 PM'],
    asserts: [
      A.offered('Haunted Mansion'),
      A.captionNot('Haunted Mansion', /(?<!if )you haven'?t (ridden|done|tried|been on)/i, "asserts the guest hasn't ridden it"),
    ],
    expectation: 'Haunted Mansion (where the guest is standing) is in the candidates and may be rank 1. Its caption does not assume the guest has not ridden it ("if you haven\'t done it yet", "go here first" and "you\'re already here" are all fine).',
    ideal: [
      { ride: 'Haunted Mansion', caption: "Half its usual line, and you're standing right here." },
      { ride: 'Pirates of the Caribbean', caption: 'A short walk, and its line is right at normal.' },
      { ride: 'Indiana Jones Adventure', caption: 'A bit under its usual line if you want a thrill.' },
    ],
    bad: [{ ride: 'Haunted Mansion', caption: "You haven't ridden this yet, and it's half the usual line." }],
    badIsCodeOnly: true, // no judge question covers this; the scenario's code assertion does
  },
];

export const fixtureById = (id: string) => {
  const f = FIXTURES.find(x => x.id === id);
  if (!f) throw new Error(`Unknown fixture ${id}. Available: ${FIXTURES.map(x => x.id).join(', ')}`);
  return f;
};
