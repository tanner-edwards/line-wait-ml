import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVALS_ROOT } from '../args';
// Scenarios from the spec "AI Recommendation Expectations" (2026-11-16), section 11.
// Values the spec states are used as-is. Every value the spec does NOT state is listed in that
// fixture's `filled` array so Tanner can confirm or correct it (never adjusted silently).
// Static ride facts (height, thrill, pregnancy advisory, ids) come from ride_metadata.json.
//
// `ideal` answers adapt the 2026-11-16 draft's target captions to the final spec's rules (for
// example skip picks open with busy-day framing; a reopened ride warns the line may be longer).
// They must pass every code check (verified by `npm run dry-run`). `bad` answers must fail.

import { A } from '../checks';
import { holdoutById } from './holdout';
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
    persona: { tripDuration: null, youngestAge: 18, ridePreferences: ['thrills', 'classics'], mustDoRideIds: [], accessibilityNeeds: ['pregnant'] },
    anchor: BUZZ,
    rides: [
      { name: 'Indiana Jones Adventure', wait: 30, usual: 55, verdict: 'star', reason: 'rare-low', walk: 9 },
      { name: 'Pirates of the Caribbean', wait: 15, usual: 30, verdict: 'go', reason: 'below-usual', walk: 10 },
      { name: 'Jungle Cruise', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 9 },
      { name: 'Haunted Mansion', wait: 25, usual: 25, verdict: 'neutral', reason: 'none', walk: 11 },
      { name: 'Big Thunder Mountain Railroad', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
      { name: 'Finding Nemo Submarine Voyage', wait: 15, usual: 25, verdict: 'go', reason: 'below-usual', walk: 3 },
    ],
    weather: { tempF: 75, feelsF: 75, conditions: 'clear' },
    filled: [BUZZ_NOTE, 'Walk times: Indy 9, Pirates 10, Jungle Cruise 9, Haunted Mansion 11, Big Thunder 12', 'Big Thunder usual 35', 'Party as persona: youngestAge 18 (two adults), ride preferences thrills and classics (classics added 2026-11-21 so the preference check can arm; the thrill rides are restricted for the pregnant guest)', 'Hours 8:00 AM to 11:00 PM', 'Weather 75F clear', 'Forecasts flat at the current wait', 'Finding Nemo at 15 (usual 25) added 2026-11-21 as the trap: a short walk and a modest deal, but neither a thrill nor a classic, and adults rate it 3.1'],
    // Pirates and Jungle Cruise tie on the ranking rules (both far-below, 15 under usual, flat);
    // the shorter walk breaks the tie, so either may lead (2026-11-17).
    asserts: [A.rank1Of('Pirates of the Caribbean', 'Jungle Cruise'), A.notRank1('Indiana Jones Adventure')],
    expectation: 'Rank 1 is Pirates or Jungle Cruise. Indiana Jones is not rank 1. Indiana Jones and Big Thunder carry a pregnancy restriction note if ranked at all. The rank 1 caption may name Indiana Jones as the answered objection.',
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
    persona: { tripDuration: null, youngestAge: 18, ridePreferences: ['thrills', 'classics'], mustDoRideIds: [], accessibilityNeeds: ['pregnant'] },
    anchor: BUZZ,
    rides: [
      { name: 'Indiana Jones Adventure', wait: 30, usual: 55, verdict: 'star', reason: 'rare-low', walk: 9, wanted: true },
      { name: 'Pirates of the Caribbean', wait: 15, usual: 30, verdict: 'go', reason: 'below-usual', walk: 10 },
      { name: 'Jungle Cruise', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 9 },
      { name: 'Haunted Mansion', wait: 25, usual: 25, verdict: 'neutral', reason: 'none', walk: 11 },
      { name: 'Big Thunder Mountain Railroad', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
      { name: 'Finding Nemo Submarine Voyage', wait: 15, usual: 25, verdict: 'go', reason: 'below-usual', walk: 3 },
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
    persona: { tripDuration: null, youngestAge: 3, ridePreferences: ['kid-favorites'], mustDoRideIds: [], accessibilityNeeds: ['stroller'] },
    anchor: { name: 'Mad Tea Party', wait: 15, usual: 15, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Star Wars: Rise of the Resistance', wait: 40, usual: 75, verdict: 'star', reason: 'rare-low', walk: 14 },
      { name: 'Big Thunder Mountain Railroad', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: "Peter Pan's Flight", wait: 25, usual: 50, verdict: 'go', reason: 'below-usual', walk: 4 },
      { name: 'Dumbo the Flying Elephant', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 3 },
      { name: 'Storybook Land Canal Boats', wait: 15, usual: 25, verdict: 'neutral', reason: 'none', walk: 5 },
    ],
    filled: ['Anchor Mad Tea Party: wait 15, usual 15, neutral', 'Big Thunder usual 35', 'Hours 8:00 AM to 11:00 PM', 'Forecasts flat', 'Kid favorites selected (2026-11-21): Big Thunder is the trap for both the age and the preference check'],
    asserts: [A.rank1Of("Peter Pan's Flight", 'Dumbo the Flying Elephant'), A.notRank1('Star Wars: Rise of the Resistance')],
    expectation: "Rank 1 is Peter Pan's Flight or Dumbo (a toss-up for a toddler who asked for kid favorites, Tanner 2026-11-21). Rise of the Resistance is not rank 1; it is restricted for the toddler (40 in. minimum) and its note says so if listed.",
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
    persona: { tripDuration: null, youngestAge: 3, ridePreferences: ['kid-favorites'], mustDoRideIds: [], accessibilityNeeds: ['stroller'] },
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
    bad: [{ ride: 'Star Wars: Rise of the Resistance', caption: "You were hoping for this one, and it's close to half its usual line." }],
  },
  {
    id: 'S2B', title: 'Toddler, Rise of the Resistance at a third of usual (not wanted)',
    tests: 'A far-below restricted headliner is surfaced with its note and "rarely this short" is allowed, but party fit (spec 8 rule 3) and the stroller walk keep it off rank 1. Corrected 2026-11-17: the draft had Rise at rank 1, which contradicted the ranking order.',
    park: 'disneyland', localTime: 'Saturday 11:00 AM', nowMin: SAT(11, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 3, ridePreferences: ['kid-favorites'], mustDoRideIds: [], accessibilityNeeds: ['stroller'] },
    anchor: { name: 'Mad Tea Party', wait: 15, usual: 15, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Star Wars: Rise of the Resistance', wait: 25, usual: 75, verdict: 'star', reason: 'rare-low', walk: 14 },
      { name: 'Big Thunder Mountain Railroad', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: "Peter Pan's Flight", wait: 25, usual: 50, verdict: 'go', reason: 'below-usual', walk: 4 },
      { name: 'Dumbo the Flying Elephant', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 3 },
      { name: 'Storybook Land Canal Boats', wait: 15, usual: 25, verdict: 'neutral', reason: 'none', walk: 5 },
    ],
    filled: ['Same as S2, with Rise of the Resistance at 25 and not wanted'],
    asserts: [
      A.either('rank 1 is Peter Pan or Dumbo', A.rank1("Peter Pan's Flight"), A.rank1('Dumbo the Flying Elephant')),
      A.notRank1('Star Wars: Rise of the Resistance'),
    ],
    expectation: 'Peter Pan or Dumbo is rank 1. Rise of the Resistance may be listed but is not rank 1: the toddler cannot ride it and it is a 14-minute walk with a stroller, and the guest did not ask for it. "Rarely this short" is allowed on Rise. Its restriction note says the toddler is under the minimum.',
    ideal: [
      { ride: "Peter Pan's Flight", caption: 'Half its usual line, and an easy ride for your toddler.' },
      { ride: 'Dumbo the Flying Elephant', caption: 'Under its usual line, and toddlers love it.' },
      { ride: 'Star Wars: Rise of the Resistance', caption: "Rarely this short, but your toddler sits out; rider swap if you have two adults.", note: 'Your toddler is under the 40-inch minimum.' },
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
    persona: { tripDuration: null, youngestAge: 8, ridePreferences: ['thrills'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Mark Twain Riverboat', wait: 10, usual: 10, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Big Thunder Mountain Railroad', wait: 30, usual: 35, verdict: 'neutral', reason: 'trivial-drop', walk: 2 },
      { name: 'Pirates of the Caribbean', wait: 25, usual: 30, verdict: 'neutral', reason: 'trivial-drop', walk: 4, wanted: true },
      { name: 'Space Mountain', wait: 40, usual: 45, verdict: 'neutral', reason: 'trivial-drop', walk: 12 },
    ],
    filled: ['Anchor Mark Twain Riverboat: wait 10, usual 10, neutral (its real feed posts no wait)', 'Verdicts neutral / trivial-drop for all three', 'Party: two adults, kids 8 and 10 (youngestAge 8), thrills selected (2026-11-21: the riverboat is the only pick that fits nothing)', 'Hours 8:00 AM to 11:00 PM', 'Forecasts flat'],
    asserts: [
      A.noCaption(/\b(rare|rarely|great deal|best window)\b/i, 'says "rare", "great deal" or "best window"'),
      A.topTwoFrom(['Pirates of the Caribbean', 'Big Thunder Mountain Railroad']),
      A.below('Space Mountain', ['Pirates of the Caribbean', 'Big Thunder Mountain Railroad']),
    ],
    expectation: 'No caption uses "rare", "great deal" or "best window". Ranks 1 and 2 are Pirates (wanted) and Big Thunder (closest), in either order. Space Mountain ranks below both.',
    ideal: [
      { ride: 'Big Thunder Mountain Railroad', caption: 'The shortest walk, and lines everywhere are a bit under usual.' },
      { ride: 'Pirates of the Caribbean', caption: 'A bit under normal and a short walk. Head over.' },
      { ride: 'Space Mountain', caption: 'A popular thrill ride with a line a bit under usual.' },
    ],
    bad: [{ ride: 'Space Mountain', caption: 'A rare chance at a great deal on a headliner.' }],
  },
  // ------------------------------------------------------------------ S4
  {
    id: 'S4', title: 'Bad field, wanted ride high and staying high',
    tests: 'Honest framing; a wanted ride with a weak window is not oversold; always at least one recommendation; the lead pick suits the youngest (6).',
    park: 'disneyland', localTime: 'Saturday 12:30 PM', nowMin: SAT(12, 30), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 6, ridePreferences: ['kid-favorites'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Mad Tea Party', wait: 40, usual: 25, verdict: 'skip', reason: 'busy-no-relief', walk: 0 },
    rides: [
      { name: 'Matterhorn Bobsleds', wait: 40, usual: 35, verdict: 'neutral', reason: 'none', walk: 6 },
      { name: 'Dumbo the Flying Elephant', wait: 45, usual: 30, verdict: 'skip', reason: 'busy-no-relief', walk: 3 },
      { name: "Peter Pan's Flight", wait: 75, usual: 50, verdict: 'skip', reason: 'busy-no-relief', walk: 3, wanted: true, buckets: [75, 72, 70, 70, 70, 70] },
      { name: 'Space Mountain', wait: 80, usual: 45, verdict: 'skip', reason: 'busy-no-relief', walk: 10 },
    ],
    filled: ['Anchor Mad Tea Party: wait 40, usual 25, skip', 'Walk: Matterhorn 6, Dumbo 3, Peter Pan 3, Space 10 (from the draft)', 'Party: two adults, kids 6 and 9 (youngestAge 6), kid favorites selected (2026-11-21)', 'Verdict reasons busy-no-relief', 'Hours 8:00 AM to 11:00 PM', 'Peter Pan forecast 75, 72, 70, 70, 70, 70; others flat', 'Decision 2026-11-21 (Tanner): Matterhorn should not lead for a 6-year-old (preschool survey appeal 2.8); it may appear lower'],
    asserts: [
      A.notRank1('Matterhorn Bobsleds'),
      A.present("Peter Pan's Flight"),
      A.captionIf("Peter Pan's Flight", WONT_SHORTER, "says honestly it won't get shorter"),
    ],
    expectation: "At least one recommendation. The lead pick suits the youngest (6): Matterhorn, a rough coaster young kids rate low, does not lead but may appear lower for the older kid. Every skip-verdict pick's caption opens with busy-day framing (first clause). Peter Pan's Flight appears with honest copy (one you had your eye on, and it won't get shorter), never positive-timing words. Space Mountain may be omitted.",
    ideal: [
      { ride: 'Dumbo the Flying Elephant', caption: 'Lines are long everywhere, and this one is a short walk for the kids.' },
      { ride: "Peter Pan's Flight", caption: "You wanted to ride this one, and the line is staying long this afternoon." },
      { ride: 'Matterhorn Bobsleds', caption: 'Closest to its normal line, a good one for your older kid.' },
    ],
    bad: [{ ride: "Peter Pan's Flight", caption: 'Great time to ride, the line is moving fast.' }],
  },
  // ------------------------------------------------------------------ S5
  {
    id: 'S5', title: 'Wanted ride with a skip verdict, line staying high',
    tests: 'A skip verdict never silently drops a wanted ride; the forecast drives go-or-wait.',
    park: 'disneyland', localTime: 'Saturday 4:00 PM', nowMin: SAT(16, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 9, ridePreferences: ['thrills'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: BUZZ,
    rides: [
      { name: 'Space Mountain', wait: 55, usual: 40, verdict: 'skip', reason: 'busy-no-relief', walk: 3, wanted: true, buckets: [55, 57, 58, 60, 58, 57] },
      { name: 'Matterhorn Bobsleds', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: 'Big Thunder Mountain Railroad', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
      { name: "Pinocchio's Daring Journey", wait: 5, usual: 15, verdict: 'go', reason: 'below-usual', walk: 9 },
    ],
    filled: [BUZZ_NOTE, 'Party: two adults, kids 9 and 12 (youngestAge 9), thrills selected (2026-11-21)', 'Space forecast 55, 57, 58, 60, 58, 57; others flat', 'Pinocchio at 5 (usual 15) added 2026-11-21 as the age-fit trap: a walk-on too young for 9 and 12 (grade-school appeal 3.4)'],
    // Skip gate (2026-11-17): under 80% of this pool is skip, so Space Mountain stays only
    // because it is wanted, and the server ranks it after every non-skip pick.
    asserts: [
      A.rank1Of('Matterhorn Bobsleds', 'Big Thunder Mountain Railroad'),
      A.notRank1('Space Mountain'),
      A.captionIf('Space Mountain', WONT_SHORTER, "says it won't get shorter"),
      A.either('Space is last or absent', A.absent('Space Mountain'), A.last('Space Mountain')),
    ],
    expectation: 'Matterhorn or Big Thunder leads. Space Mountain, if listed, is last and its caption says it won\'t get shorter today.',
    ideal: [
      { ride: 'Matterhorn Bobsleds', caption: 'About 15 minutes shorter than usual, a good one to add.' },
      { ride: 'Big Thunder Mountain Railroad', caption: 'A bit under its usual line, if you want another thrill.' },
      { ride: 'Space Mountain', caption: "One you had your eye on, and it won't get shorter today." },
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
    persona: { tripDuration: null, youngestAge: 9, ridePreferences: ['thrills'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: BUZZ,
    rides: [
      { name: 'Space Mountain', wait: 55, usual: 40, verdict: 'skip', reason: 'dropping-soon', walk: 3, wanted: true, buckets: [55, 45, 40, 40, 40, 40], window: { wait: 40, inMin: 60 } },
      { name: 'Matterhorn Bobsleds', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: 'Big Thunder Mountain Railroad', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
      { name: "Pinocchio's Daring Journey", wait: 5, usual: 15, verdict: 'go', reason: 'below-usual', walk: 9 },
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
    persona: { tripDuration: null, youngestAge: 15, ridePreferences: ['thrills'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Pirates of the Caribbean', wait: 20, usual: 20, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Haunted Mansion', wait: 15, usual: 25, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: 'Space Mountain', wait: 60, usual: 45, verdict: 'neutral', reason: 'none', walk: 14, buckets: [60, 45, 40, 40, 40, 40] },
      { name: 'Big Thunder Mountain Railroad', wait: 40, usual: 35, verdict: 'neutral', reason: 'none', walk: 6, buckets: [40, 25, 25, 25, 25, 25] },
      { name: 'Matterhorn Bobsleds', wait: 30, usual: 35, verdict: 'go', reason: 'below-usual', walk: 10 },
      { name: 'Dumbo the Flying Elephant', wait: 5, usual: 20, verdict: 'go', reason: 'below-usual', walk: 7 },
    ],
    weather: { tempF: 62, feelsF: 62, conditions: 'clear' },
    filled: ['Anchor Pirates: wait 20, usual 20, neutral', 'Party: two adults and a 15-year-old (youngestAge 15), thrills selected (2026-11-21: Matterhorn, the only thrill ride with a go verdict, belongs in the top two)', 'Space forecast 60, 45, 40, 40, 40, 40 (spec: about 40 by 10:50)', 'Big Thunder forecast 40, 25, 25... (spec: about 25 within 30 minutes)', 'Weather 62F clear', 'Dumbo at 5 (usual 20) added 2026-11-21 as the age-fit trap: a walk-on the 15-year-old would not thank you for (teen appeal 3.2)'],
    asserts: [
      A.rank1('Haunted Mansion'),
      A.rank('Big Thunder Mountain Railroad', 2),
      A.present('Space Mountain'),
      A.captionIf('Space Mountain', /(clos|in line|before (the )?(park|end))/i, 'says being in line before close still rides'),
    ],
    expectation: 'Every pick is reachable before close. The answer is a sequence (Tanner, 2026-11-21): Haunted Mansion is rank 1, a quick line to do now; Big Thunder is rank 2, the thrill ride the teen asked for, long now but dropping within the half hour, so line up there after and ride before close. Space Mountain is present and its caption says in line before close still rides. Dumbo, a walk-on, is not in the top two.',
    ideal: [
      { ride: 'Haunted Mansion', caption: 'Quick line now, and you can still line up for Big Thunder after.' },
      { ride: 'Big Thunder Mountain Railroad', caption: "Longer than usual now, but it's dropping, and in line before close still rides." },
      { ride: 'Space Mountain', caption: "In line before close means you still ride, and the wait's falling." },
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
    persona: { tripDuration: null, youngestAge: 10, ridePreferences: ['thrills'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: BUZZ,
    rides: [
      { name: 'Space Mountain', wait: 15, usual: 45, verdict: 'star', reason: 'rare-low', walk: 1, minutesSinceReopen: 20, buckets: [15, 25, 35, 38, 40, 40] },
      { name: 'Matterhorn Bobsleds', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: 'Big Thunder Mountain Railroad', wait: 30, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
      { name: 'Casey Jr. Circus Train', wait: 5, usual: 15, verdict: 'go', reason: 'below-usual', walk: 9 },
    ],
    filled: [BUZZ_NOTE, 'Party: two adults, kids 10 and 12 (youngestAge 10), thrills selected (2026-11-21)', 'Space forecast 15, 25, 35, 38, 40, 40 (spec 6.13 example)', 'Casey Jr at 5 (usual 15) added 2026-11-21 as the age-fit trap: a walk-on that is too young for 10 and 12 (appeal 3.2 for 10-12)'],
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
    bad: [{ ride: 'Big Thunder Mountain Railroad', caption: 'A bit under its usual line, and holding steady.' }], // wrong ride leads; "rare" on a reopened ride is only a soft flag now
  },
  {
    id: 'S7v', title: 'Reopened ride next door (5 minutes ago)',
    tests: 'A just-reopened posted time is not trusted enough to lead.',
    park: 'disneyland', localTime: 'Saturday 11:30 AM', nowMin: SAT(11, 30), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 10, ridePreferences: ['thrills'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: BUZZ,
    rides: [
      { name: 'Space Mountain', wait: 15, usual: 45, verdict: 'star', reason: 'rare-low', walk: 1, minutesSinceReopen: 5, buckets: [15, 25, 35, 38, 40, 40] },
      { name: 'Matterhorn Bobsleds', wait: 25, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: 'Big Thunder Mountain Railroad', wait: 30, usual: 35, verdict: 'go', reason: 'below-usual', walk: 12 },
      { name: 'Casey Jr. Circus Train', wait: 5, usual: 15, verdict: 'go', reason: 'below-usual', walk: 9 },
    ],
    filled: ['Same as S7 with minutesSinceReopen 5. The reopen threshold is still being tuned (spec 6.6): report separately.'],
    asserts: [
      A.present('Space Mountain'),
      A.captionIf('Space Mountain', /(check|real line|actual line|posted|lag|settle|just reopened)/i, 'warns the posted wait has not settled'),
    ],
    expectation: 'Space Mountain is one minute away and posting 15, so it may lead or sit second; either way its caption warns the posted wait has not settled since it just reopened. Matterhorn is the steady alternative. (Tanner, 2026-11-17: a 5-minute line next door is worth checking; across the park it would not be.)',
    ideal: [
      { ride: 'Matterhorn Bobsleds', caption: "A steady line, and a safe pick while Space Mountain's wait settles." },
      { ride: 'Space Mountain', caption: 'Just reopened, so check the real line before you commit.' },
      { ride: 'Big Thunder Mountain Railroad', caption: "A bit under its usual line, and it's holding steady." },
    ],
    bad: [{ ride: 'Matterhorn Bobsleds', caption: 'A steady line and a short walk, go now.' }], // omits the just-reopened ride entirely
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
      { ride: 'WEB SLINGERS: A Spider-Man Adventure', caption: "Lines are long everywhere today, and you're already standing here." },
      { ride: 'Monsters, Inc. Mike & Sulley to the Rescue!', caption: 'Lines are long today, and this short walk is the easiest win.' },
    ],
    bad: [{ ride: 'Radiator Springs Racers', caption: 'Wait will drop to ~95 min in 1.5 hours.' }],
  },
  // ------------------------------------------------------------------ S9
  {
    id: 'S9', title: 'Anchor ride is a good pick',
    tests: 'The ride the guest is standing at is a candidate, not silently removed.',
    park: 'disneyland', localTime: 'Saturday 2:00 PM', nowMin: SAT(14, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 18, ridePreferences: ['immersive'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Haunted Mansion', wait: 20, usual: 40, verdict: 'go', reason: 'below-usual', walk: 0 },
    rides: [
      { name: 'Pirates of the Caribbean', wait: 30, usual: 30, verdict: 'neutral', reason: 'none', walk: 2 },
      { name: 'Jungle Cruise', wait: 35, usual: 35, verdict: 'neutral', reason: 'none', walk: 4 },
      { name: 'Indiana Jones Adventure', wait: 50, usual: 55, verdict: 'neutral', reason: 'trivial-drop', walk: 4 },
      { name: 'Big Thunder Mountain Railroad', wait: 35, usual: 40, verdict: 'neutral', reason: 'trivial-drop', walk: 6 },
      { name: 'The Many Adventures of Winnie the Pooh', wait: 10, usual: 20, verdict: 'go', reason: 'below-usual', walk: 3 },
    ],
    filled: ['Local time Saturday 2:00 PM', 'Party: two adults (youngestAge 18), immersive selected (2026-11-21: Indiana Jones is the only pick that fits)', 'Other rides: Pirates 30/30, Jungle Cruise 35/35, Indy 50/55, Big Thunder 35/40, all neutral', 'Hours 8:00 AM to 11:00 PM', 'Winnie the Pooh at 10 (usual 20) added 2026-11-21 as the age trap: a short walk and half its line, but adults rate it 3.5'],
    asserts: [
      A.offered('Haunted Mansion'),
      A.captionNot('Haunted Mansion', /(?<!if )you haven'?t (ridden|done|tried|been on)/i, "asserts the guest hasn't ridden it"),
    ],
    expectation: 'Haunted Mansion (where the guest is standing) is in the candidates and may be rank 1. Its caption does not assume the guest has not ridden it ("if you haven\'t done it yet", "go here first" and "you\'re already here" are all fine).',
    ideal: [
      { ride: 'Haunted Mansion', caption: "Half its usual line, and you're standing right here." },
      { ride: 'Indiana Jones Adventure', caption: 'A bit under its usual line, and the kind of ride you asked for.' },
      { ride: 'Pirates of the Caribbean', caption: 'A short walk, and its line is right at normal.' },
    ],
    bad: [{ ride: 'Haunted Mansion', caption: "Haunted Mansion is half its usual line, you haven't ridden this yet." }], // own name is a hard check; the hasn't-ridden wording is soft
    badIsCodeOnly: true, // no judge question covers this; the scenario's code assertion does
  },
  // ------------------------------------------------------------------ S10
  {
    id: 'S10', title: 'Teen wants thrills, walk-on kiddie rides next door',
    tests: 'A preference and an age both point away from the easy walk-ons; the coaster on a deal leads (added 2026-11-21).',
    park: 'disneyland', localTime: 'Saturday 3:00 PM', nowMin: SAT(15, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 14, ridePreferences: ['thrills'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Matterhorn Bobsleds', wait: 35, usual: 35, verdict: 'neutral', reason: 'none', walk: 0 },
    rides: [
      { name: 'Space Mountain', wait: 30, usual: 45, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: 'Big Thunder Mountain Railroad', wait: 40, usual: 40, verdict: 'neutral', reason: 'none', walk: 12 },
      { name: 'Indiana Jones Adventure', wait: 45, usual: 55, verdict: 'neutral', reason: 'trivial-drop', walk: 14 },
      { name: 'Dumbo the Flying Elephant', wait: 5, usual: 25, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: 'Casey Jr. Circus Train', wait: 5, usual: 15, verdict: 'go', reason: 'below-usual', walk: 3 },
      { name: 'Alice in Wonderland', wait: 10, usual: 25, verdict: 'go', reason: 'below-usual', walk: 2 },
    ],
    filled: ['Anchor Matterhorn: wait 35, usual 35, neutral', 'Party: two adults and a 14-year-old (youngestAge 14), thrills selected', 'Dumbo 5/25, Casey Jr 5/15, Alice 10/25: walk-ons a short walk away that teens rate 3.2, 2.7 and 3.3', 'Space 30/45 go walk 8; Big Thunder 40/40 neutral walk 12; Indy 45/55 neutral walk 14', 'Hours 8:00 AM to 11:00 PM', 'Forecasts flat'],
    asserts: [A.rank1('Space Mountain'), A.notRank1('Dumbo the Flying Elephant'), A.notRank1('Casey Jr. Circus Train')],
    expectation: 'Space Mountain leads: a third off its usual line and the kind of ride the party asked for. The Fantasyland walk-ons may appear lower, but not in the top two: the teen rates them low and they are not what the party asked for. Matterhorn, where the guest is standing, is the natural second; Big Thunder is a 12-minute walk for a line at normal, so it sits third.',
    ideal: [
      { ride: 'Space Mountain', caption: 'A third off its usual line, and the coaster your teen came for.' },
      { ride: 'Matterhorn Bobsleds', caption: "You're standing at it, and the line is about normal." },
      { ride: 'Big Thunder Mountain Railroad', caption: 'Right at normal, and a good coaster to add after.' },
    ],
    bad: [
      { ride: 'Dumbo the Flying Elephant', caption: 'A walk-on right now, grab it.' },
      { ride: 'Casey Jr. Circus Train', caption: 'No line at all, a quick one.' },
      { ride: 'Space Mountain', caption: 'A third off its usual line.' },
    ],
  },
  // ------------------------------------------------------------------ S11
  {
    id: 'S11', title: 'Classics party, star verdict on an immersive headliner',
    tests: 'A star may still lead, but the classics the party asked for fill the top three ahead of a short gentle line that fits nothing (added 2026-11-21).',
    park: 'disneyland', localTime: 'Sunday 10:30 AM', nowMin: SAT(10, 30), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 18, ridePreferences: ['classics'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Jungle Cruise', wait: 15, usual: 30, verdict: 'go', reason: 'below-usual', walk: 0 },
    rides: [
      { name: 'Star Wars: Rise of the Resistance', wait: 35, usual: 80, verdict: 'star', reason: 'rare-low', walk: 12 },
      { name: 'Pirates of the Caribbean', wait: 10, usual: 25, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: 'Haunted Mansion', wait: 20, usual: 35, verdict: 'go', reason: 'below-usual', walk: 3 },
      { name: 'Big Thunder Mountain Railroad', wait: 30, usual: 35, verdict: 'neutral', reason: 'trivial-drop', walk: 6 },
      { name: 'Finding Nemo Submarine Voyage', wait: 10, usual: 20, verdict: 'go', reason: 'below-usual', walk: 10 },
    ],
    filled: ['Anchor Jungle Cruise: wait 15, usual 30, go', 'Party: two adults (youngestAge 18), classics selected', 'Rise 35/80 star walk 12 (immersive, not a classic by the metadata tags)', 'Pirates 10/25 go walk 2; Haunted 20/35 go walk 3; Big Thunder 30/35 neutral walk 6', 'Finding Nemo 10/20 go walk 10: fits nothing the party asked for and adults rate it 3.1', 'Hours 8:00 AM to 11:00 PM', 'Forecasts flat'],
    asserts: [A.notRank1('Finding Nemo Submarine Voyage'), A.below('Finding Nemo Submarine Voyage', ['Pirates of the Caribbean', 'Haunted Mansion'])],
    expectation: 'Rise of the Resistance may lead on its rare line. Pirates and Haunted Mansion, the classics the party asked for and both under their usual lines, fill the top three with it. Finding Nemo ranks below both of them if it appears at all.',
    ideal: [
      { ride: 'Star Wars: Rise of the Resistance', caption: "Rarely this short, and the park's biggest ride." },
      { ride: 'Pirates of the Caribbean', caption: 'Well under its usual line, and the kind of classic you asked for.' },
      { ride: 'Haunted Mansion', caption: 'Under its usual line and a short walk, another classic.' },
    ],
    bad: [
      { ride: 'Finding Nemo Submarine Voyage', caption: 'Half its usual line.' },
      { ride: 'Star Wars: Rise of the Resistance', caption: "Rarely this short, and the park's biggest ride." },
    ],
  },
  // ------------------------------------------------------------------ S12
  {
    id: 'S12', title: 'Toddler party, parents picked thrills and kid favorites',
    tests: 'Two selected categories that pull opposite ways (coasters and the gentlest rides); the age still rules out the rough rides. The carousel underfoot is already ridden, so it is not in the pool (added 2026-11-21).',
    park: 'disneyland', localTime: 'Saturday 10:00 AM', nowMin: SAT(10, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 4, ridePreferences: ['thrills', 'kid-favorites'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'King Arthur Carrousel', wait: 5, usual: 10, verdict: 'go', reason: 'below-usual', walk: 0, ridden: true },
    rides: [
      { name: 'Indiana Jones Adventure', wait: 20, usual: 50, verdict: 'star', reason: 'rare-low', walk: 12 },
      { name: 'Matterhorn Bobsleds', wait: 15, usual: 35, verdict: 'go', reason: 'below-usual', walk: 4 },
      { name: 'Dumbo the Flying Elephant', wait: 15, usual: 30, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: "Peter Pan's Flight", wait: 30, usual: 50, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: 'Pirates of the Caribbean', wait: 15, usual: 30, verdict: 'go', reason: 'below-usual', walk: 10 },
    ],
    filled: ['Anchor King Arthur Carrousel: wait 5, usual 10, go, marked ridden (Tanner 2026-11-21: both models led with it otherwise, which is what would really happen; the app only knows via "Rode it")', 'Party: two adults and a 4-year-old (youngestAge 4), thrills and kid favorites both selected', 'Indy 20/50 star walk 12 (46 in. minimum); Matterhorn 15/35 go walk 4 (42 in. minimum); Dumbo 15/30 go walk 2; Peter Pan 30/50 go walk 2; Pirates 15/30 go walk 10', 'Hours 8:00 AM to 11:00 PM', 'Forecasts flat'],
    asserts: [A.rank1Of('Dumbo the Flying Elephant', "Peter Pan's Flight"), A.notRank1('Indiana Jones Adventure'), A.notRank1('Matterhorn Bobsleds')],
    expectation: 'Dumbo or Peter Pan leads. The carousel the guest is standing at was already ridden and is not offered. Indiana Jones and Matterhorn are not in the top two: the 4-year-old cannot ride Indy, rates both low, and the parents picking thrills does not change that. If either is listed its note says who sits out.',
    ideal: [
      { ride: "Peter Pan's Flight", caption: 'Under its usual line, and the one little kids ask for first.' },
      { ride: 'Dumbo the Flying Elephant', caption: 'Half its usual line, and a short walk for small legs.' },
      { ride: 'Pirates of the Caribbean', caption: 'Half its usual line, and gentle enough for everyone.' },
    ],
    bad: [
      { ride: 'Indiana Jones Adventure', caption: 'Rarely this short, grab it while it lasts.' },
      { ride: 'Matterhorn Bobsleds', caption: 'Well under its usual line.' },
    ],
  },
  // ------------------------------------------------------------------ S13
  {
    id: 'S13', title: 'Kids 11 and 12, kid favorites selected, coasters on a deal',
    tests: 'A gentle preference for older kids: the star coaster may lead, but a go coaster does not beat the gentle rides the party asked for (added 2026-11-21).',
    park: 'disneyland', localTime: 'Sunday 1:00 PM', nowMin: SAT(13, 0), hours: DL_HOURS,
    persona: { tripDuration: null, youngestAge: 11, ridePreferences: ['kid-favorites'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: BUZZ,
    rides: [
      { name: 'Space Mountain', wait: 20, usual: 45, verdict: 'star', reason: 'rare-low', walk: 2 },
      { name: 'Matterhorn Bobsleds', wait: 15, usual: 35, verdict: 'go', reason: 'below-usual', walk: 8 },
      { name: "Peter Pan's Flight", wait: 25, usual: 50, verdict: 'go', reason: 'below-usual', walk: 9 },
      { name: "it's a small world", wait: 10, usual: 20, verdict: 'go', reason: 'below-usual', walk: 10 },
      { name: 'Alice in Wonderland', wait: 10, usual: 25, verdict: 'go', reason: 'below-usual', walk: 9 },
    ],
    filled: [BUZZ_NOTE, 'Party: two adults, kids 11 and 12 (youngestAge 11), kid favorites selected', 'Space 20/45 star walk 2; Matterhorn 15/35 go walk 8; Peter Pan 25/50 go walk 9; small world 10/20 go walk 10; Alice 10/25 go walk 9', 'Hours 8:00 AM to 11:00 PM', 'Forecasts flat'],
    asserts: [A.present("Peter Pan's Flight"), A.below('Matterhorn Bobsleds', ["Peter Pan's Flight"])],
    expectation: 'Space Mountain may lead on its rare line next door. Peter Pan, half its usual line and the kind of ride the party asked for, is present and ranks above Matterhorn. The gentle rides are not flagged for the kids\' age because the party asked for them.',
    ideal: [
      { ride: "Peter Pan's Flight", caption: 'Half its usual line, and the gentle classic you asked for.' },
      { ride: 'Space Mountain', caption: 'Rarely this short and right next door, if the kids are up for it.' },
      { ride: 'Alice in Wonderland', caption: 'Well under normal, a short dark ride the kids will like.' },
    ],
    bad: [
      { ride: 'Matterhorn Bobsleds', caption: 'Well under its usual line.' },
      { ride: 'Space Mountain', caption: 'Rarely this short and right next door.' },
    ],
  },
  // ------------------------------------------------------------------ S14
  {
    id: 'S14', title: 'First visit, nothing else selected',
    tests: 'First-time is the catch-all preference: no category check applies, the famous rides lead, and the short gentle lines next door do not (added 2026-11-21).',
    park: 'disneyland', localTime: 'Saturday 9:30 AM', nowMin: SAT(9, 30), hours: DL_HOURS,
    persona: { tripDuration: '1-day', youngestAge: 18, ridePreferences: ['first-time'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Astro Orbitor', wait: 5, usual: 15, verdict: 'go', reason: 'below-usual', walk: 0 },
    rides: [
      { name: 'Space Mountain', wait: 20, usual: 40, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: 'Buzz Lightyear Astro Blasters', wait: 10, usual: 25, verdict: 'go', reason: 'below-usual', walk: 1 },
      { name: 'Autopia', wait: 10, usual: 25, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: 'Star Tours – The Adventures Continue', wait: 15, usual: 30, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: 'Pirates of the Caribbean', wait: 15, usual: 30, verdict: 'go', reason: 'below-usual', walk: 14 },
    ],
    filled: ['Anchor Astro Orbitor: wait 5, usual 15, go (adults rate it 2.9)', 'Party: two adults (youngestAge 18), first visit, one-day trip, nothing else selected', 'Space 20/40 go walk 2; Buzz 10/25 go walk 1; Autopia 10/25 go walk 2 (adults rate it 3.0); Star Tours 15/30 go walk 2; Pirates 15/30 go walk 14', 'Hours 8:00 AM to 11:00 PM', 'Forecasts flat'],
    asserts: [A.notRank1('Astro Orbitor'), A.notRank1('Autopia'), A.present('Space Mountain')],
    expectation: 'Space Mountain is present and the famous rides lead. Astro Orbitor (where the guest is standing) and Autopia are not rank 1: short lines, but adults rate them low and a first-timer should be sent to the rides the park is known for. Captions say in plain words what each ride is.',
    ideal: [
      { ride: 'Space Mountain', caption: "Half its usual line, and it's the park's classic indoor coaster." },
      { ride: 'Star Tours – The Adventures Continue', caption: 'Half its usual line; a Star Wars flight simulator, good for a first visit.' },
      { ride: 'Buzz Lightyear Astro Blasters', caption: 'A short line for a ride where you shoot targets from your car.' },
    ],
    bad: [
      { ride: 'Astro Orbitor', caption: "You're standing right here and there's no line." },
      { ride: 'Autopia', caption: 'Well under its usual line.' },
    ],
  },
  // ------------------------------------------------------------------ S15
  {
    id: 'S15', title: 'DCA, kid of 8, immersive selected, carnival walk-ons next door',
    tests: 'The immersive headliners the party asked for lead over Paradise Gardens walk-ons that an 8-year-old rates low (added 2026-11-21).',
    park: 'california-adventure', localTime: 'Saturday 4:30 PM', nowMin: SAT(16, 30), hours: { open: '08:00', close: '22:00' },
    persona: { tripDuration: '2-days', youngestAge: 8, ridePreferences: ['immersive'], mustDoRideIds: [], accessibilityNeeds: [] },
    anchor: { name: 'Toy Story Midway Mania!', wait: 30, usual: 45, verdict: 'go', reason: 'below-usual', walk: 0 },
    rides: [
      { name: 'Radiator Springs Racers', wait: 45, usual: 90, verdict: 'star', reason: 'rare-low', walk: 12 },
      { name: 'WEB SLINGERS: A Spider-Man Adventure', wait: 25, usual: 50, verdict: 'go', reason: 'below-usual', walk: 9 },
      { name: "Soarin' Around the World", wait: 20, usual: 45, verdict: 'go', reason: 'below-usual', walk: 10 },
      { name: 'Golden Zephyr', wait: 5, usual: 15, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: "Jumpin' Jellyfish", wait: 5, usual: 15, verdict: 'go', reason: 'below-usual', walk: 2 },
      { name: 'Inside Out Emotional Whirlwind', wait: 5, usual: 15, verdict: 'go', reason: 'below-usual', walk: 3 },
    ],
    filled: ['Anchor Toy Story Midway Mania: wait 30, usual 45, go', 'Party: two adults and an 8-year-old (youngestAge 8), two-day trip, immersive selected', 'Radiator Springs 45/90 star walk 12; Web Slingers 25/50 go walk 9; Soarin 20/45 go walk 10', "Golden Zephyr, Jumpin' Jellyfish and Inside Out at 5 (usual 15), two or three minutes away: an 8-year-old rates them 3.6, 3.5 and 3.5", 'DCA hours 8:00 AM to 10:00 PM', 'Forecasts flat'],
    asserts: [A.topTwoFrom(['Radiator Springs Racers', 'WEB SLINGERS: A Spider-Man Adventure', "Soarin' Around the World"])],
    expectation: 'The top two are from Radiator Springs, Web Slingers and Soarin: all under their usual lines and the story-driven rides the party asked for. The three Paradise Gardens walk-ons may appear lower but not in the top two.',
    ideal: [
      { ride: 'Radiator Springs Racers', caption: "Rarely this short for the park's headliner, a fast ride through Cars Land." },
      { ride: 'WEB SLINGERS: A Spider-Man Adventure', caption: 'Half its usual line, and your kid gets to sling webs.' },
      { ride: "Soarin' Around the World", caption: 'Under its usual line, a calm hang-glide over the world.' },
    ],
    bad: [
      { ride: 'Golden Zephyr', caption: 'No line and right here.' },
      { ride: "Jumpin' Jellyfish", caption: 'No line, a quick drop for the kid.' },
      { ride: 'Radiator Springs Racers', caption: "Rarely this short for the park's headliner." },
    ],
  },
];

/** The hard cases for --smoke: restricted toddler, bad day + wanted, wanted skip, closing hour, reopened. */
export const SMOKE_SCENARIOS = ['S2', 'S4', 'S5', 'S6', 'S7'];

export const fixtureById = (id: string): Fixture => {
  const f = FIXTURES.find(x => x.id === id);
  if (f) return f;
  // Held-out scenarios from independent authors (evals/holdout/*.md, see fixtures/holdout.ts).
  if (id.startsWith('H-')) { const h = holdoutById(id); if (h) return h; }
  // Live snapshots (`npm run live`) are saved as JSON under evals/live/<id>.json. They carry
  // no scripted assertions: the hard code checks and the AI judge are the whole test.
  if (id.startsWith('LIVE-')) {
    const path = join(EVALS_ROOT, 'live', `${id}.json`);
    if (existsSync(path)) return { ...(JSON.parse(readFileSync(path, 'utf8')) as Omit<Fixture, 'asserts'>), asserts: [] };
  }
  throw new Error(`Unknown fixture ${id}. Available: ${FIXTURES.map(x => x.id).join(', ')}, or a LIVE-* id saved under evals/live/`);
};
