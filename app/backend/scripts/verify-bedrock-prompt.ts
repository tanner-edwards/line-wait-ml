// One-off CLI verification for the v2 system prompt. Builds the user message
// against a small synthetic operating-ride payload, invokes Bedrock directly,
// and prints the result. Useful when the park is closed and there are no
// real OPERATING rides in the live feed to test against.
//
// Run with:
//   BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0 \
//   BEDROCK_REGION=us-west-2 \
//   AWS_PROFILE=default \
//   npx tsx scripts/verify-bedrock-prompt.ts
//
// (Or `node --import tsx scripts/verify-bedrock-prompt.ts`.)

import { invokeRecommendations } from '../src/recommendations/bedrockClient';
import { buildUserMessage, SYSTEM_PROMPT, RideForPrompt } from '../src/recommendations/promptBuilder';
import { parseAndValidate } from '../src/recommendations/handler';
import { Ride, HistoricalAverage } from '../src/types';

function makeHA(b0: number, b1: number, b3: number, b4: number, sampleCount = 30): HistoricalAverage {
  return {
    dayType: 'weekday',
    buckets: [
      { offsetMinutes: 0,   timeSlot: '14:00-14:30', wait: b0, sampleCount },
      { offsetMinutes: 30,  timeSlot: '14:30-15:00', wait: b1, sampleCount },
      { offsetMinutes: 60,  timeSlot: '15:00-15:30', wait: Math.round((b1 + b3) / 2), sampleCount },
      { offsetMinutes: 90,  timeSlot: '15:30-16:00', wait: b3, sampleCount },
      { offsetMinutes: 120, timeSlot: '16:00-16:30', wait: b4, sampleCount },
    ],
  };
}

function makeRide(opts: {
  id: string;
  name: string;
  land: string;
  currentWait: number;
  b0: number; b1: number; b3: number; b4: number;
  p10: number; p90: number;
  badge: 'star' | 'go' | 'skip' | null;
  score: number;
}): Ride {
  return {
    id: opts.id,
    name: opts.name,
    land: opts.land,
    status: 'OPERATING',
    currentWait: opts.currentWait,
    historicalAverage: makeHA(opts.b0, opts.b1, opts.b3, opts.b4),
    rideStats: { p10: opts.p10, p90: opts.p90, sampleCount: 200 },
    prediction: null,
    score: {
      score: opts.score,
      badge: opts.badge,
      factors: {
        vsAvg: null,
        vsRange: null,
        projectedChange: null,
        nearTermChange: null,
      },
    },
  };
}

async function main() {
  const candidates: RideForPrompt[] = [
    { ride: makeRide({ id: 'big-thunder',    name: 'Big Thunder Mountain',        land: 'Frontierland',    currentWait: 25, b0: 30, b1: 35, b3: 45, b4: 50, p10: 15, p90: 60, badge: 'go',   score: 3 }), walkMinutes: 5 },
    { ride: makeRide({ id: 'space-mtn',      name: 'Hyperspace Mountain',         land: 'Tomorrowland',    currentWait: 55, b0: 50, b1: 55, b3: 60, b4: 60, p10: 30, p90: 80, badge: 'go',   score: 2 }), walkMinutes: 6 },
    { ride: makeRide({ id: 'pirates',        name: 'Pirates of the Caribbean',    land: 'New Orleans',     currentWait: 15, b0: 30, b1: 35, b3: 40, b4: 45, p10: 10, p90: 50, badge: 'star', score: 5 }), walkMinutes: 8 },
    { ride: makeRide({ id: 'matterhorn',     name: 'Matterhorn Bobsleds',         land: 'Fantasyland',     currentWait: 45, b0: 35, b1: 40, b3: 45, b4: 50, p10: 20, p90: 70, badge: 'skip', score: -2 }), walkMinutes: 9 },
    { ride: makeRide({ id: 'indy',           name: "Indiana Jones Adventure",     land: 'Adventureland',   currentWait: 40, b0: 45, b1: 50, b3: 55, b4: 60, p10: 25, p90: 80, badge: 'go',   score: 2 }), walkMinutes: 7 },
    { ride: makeRide({ id: 'haunted-mansion',name: 'Haunted Mansion',             land: 'New Orleans',     currentWait: 25, b0: 35, b1: 40, b3: 50, b4: 55, p10: 15, p90: 70, badge: 'go',   score: 3 }), walkMinutes: 8 },
    { ride: makeRide({ id: 'small-world',    name: "it's a small world",          land: 'Fantasyland',     currentWait: 5,  b0: 10, b1: 15, b3: 20, b4: 25, p10: 5,  p90: 30, badge: 'star', score: 4 }), walkMinutes: 10 },
    { ride: makeRide({ id: 'jungle-cruise',  name: 'Jungle Cruise',               land: 'Adventureland',   currentWait: 30, b0: 35, b1: 40, b3: 50, b4: 55, p10: 15, p90: 65, badge: 'go',   score: 2 }), walkMinutes: 6 },
    { ride: makeRide({ id: 'rise-resistance',name: 'Rise of the Resistance',      land: 'Galaxy\'s Edge',  currentWait: 70, b0: 60, b1: 65, b3: 75, b4: 80, p10: 45, p90: 95, badge: null,   score: 0 }), walkMinutes: 12 },
    { ride: makeRide({ id: 'autopia',        name: 'Autopia',                     land: 'Tomorrowland',    currentWait: 20, b0: 25, b1: 30, b3: 35, b4: 40, p10: 10, p90: 55, badge: 'go',   score: 2 }), walkMinutes: 6 },
  ];

  const userMessage = buildUserMessage({
    park: 'Disneyland',
    currentRide: { id: 'fake-current', name: 'Casey Jr. Circus Train' },
    currentLocalTime: 'Saturday 2:15 PM',
    parkHours: { open: '08:00', close: '23:00' },
    rides: candidates,
  });

  console.log('=== USER MESSAGE (first 400 chars) ===');
  console.log(userMessage.slice(0, 400));
  console.log('...\n');

  console.log('=== INVOKING BEDROCK ===');
  const start = Date.now();
  const text = await invokeRecommendations(SYSTEM_PROMPT, userMessage);
  const elapsed = Date.now() - start;
  console.log(`(${elapsed}ms, ${text.length} chars)\n`);

  console.log('=== RAW RESPONSE ===');
  console.log(text);
  console.log('');

  const parsed = parseAndValidate(text, candidates);
  console.log('=== PARSED ===');
  console.log(`recs: ${parsed?.length ?? 'null'}`);
  if (parsed) {
    for (const r of parsed.slice(0, 5)) {
      console.log(`  • [${r.rideId}] ${r.oneLiner}`);
    }
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
