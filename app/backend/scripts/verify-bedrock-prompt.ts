// One-off CLI verification for the v2 system prompt. Builds the user message
// against a small synthetic operating-ride payload, invokes Bedrock directly,
// and prints the result. Useful when the park is closed and there are no
// real OPERATING rides in the live feed to test against.
//
// The system prompt is sent as buildSystemPrompt's ordered text blocks
// (structural blocks, persona last), the same array the handler sends.
//
// Run with:
//   BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0 \
//   BEDROCK_REGION=us-west-2 \
//   AWS_PROFILE=default \
//   npx tsx scripts/verify-bedrock-prompt.ts
//
// (Or `node --import tsx scripts/verify-bedrock-prompt.ts`.)

import { invokeRecommendations } from '../src/recommendations/bedrockClient';
import { buildSystemPrompt, buildUserMessage, DEFAULT_PERSONA, RideForPrompt } from '../src/recommendations/promptBuilder';
import { parseAndValidate } from '../src/recommendations/handler';
import { assignCodes, buildRequestContext, buildRideLines, parkTimeZone } from '../src/recommendations/buildPromptInputs';
import { Ride, HistoricalAverage, Verdict } from '../src/types';

const BATCH_SIZE = 6;

function makeHA(b0: number, b1: number, b3: number, b4: number, sampleCount = 30): HistoricalAverage {
  return {
    dayType: 'weekday',
    buckets: [
      { offsetMinutes: 0,   timeSlot: '14:00-14:30', wait: b0, sampleCount },
      { offsetMinutes: 30,  timeSlot: '14:30-15:00', wait: b1, sampleCount },
      { offsetMinutes: 60,  timeSlot: '15:00-15:30', wait: Math.round((b1 + b3) / 2), sampleCount },
      { offsetMinutes: 90,  timeSlot: '15:30-16:00', wait: b3, sampleCount },
      { offsetMinutes: 120, timeSlot: '16:00-16:30', wait: b4, sampleCount },
      { offsetMinutes: 150, timeSlot: '16:30-17:00', wait: b4, sampleCount },
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
  verdict: Verdict;
}): Ride {
  return {
    id: opts.id,
    name: opts.name,
    land: opts.land,
    status: 'OPERATING',
    currentWait: opts.currentWait,
    historicalAverage: makeHA(opts.b0, opts.b1, opts.b3, opts.b4),
    rideStats: { p10: opts.p10, p50: Math.round((opts.p10 + opts.p90) / 2), p90: opts.p90, sampleCount: 200 },
    prediction: null,
    recentHistory: null,
    lat: null,
    lng: null,
    closedAt: null,
    verdict: {
      verdict: opts.verdict,
      reasons: {
        primary: opts.verdict === 'star' ? 'rare-low'
          : opts.verdict === 'go' ? 'below-usual'
          : opts.verdict === 'skip' ? 'high-vs-usual'
          : 'none',
        current: opts.currentWait,
        typical: opts.b0,
        todayP30: null,
        todayP80: null,
        p10: opts.p10,
        p90: opts.p90,
        beatableSoon: false,
        betterWindowWait: null,
        betterWindowInMin: null,
        star: opts.verdict === 'star',
      },
    },
  };
}

async function main() {
  const candidates: RideForPrompt[] = [
    { ride: makeRide({ id: 'big-thunder',    name: 'Big Thunder Mountain',        land: 'Frontierland',    currentWait: 25, b0: 30, b1: 35, b3: 45, b4: 50, p10: 15, p90: 60, verdict: 'go' }), walkMinutes: 5, walkYards: 400 },
    { ride: makeRide({ id: 'space-mtn',      name: 'Hyperspace Mountain',         land: 'Tomorrowland',    currentWait: 55, b0: 50, b1: 55, b3: 60, b4: 60, p10: 30, p90: 80, verdict: 'go' }), walkMinutes: 6, walkYards: 480 },
    { ride: makeRide({ id: 'pirates',        name: 'Pirates of the Caribbean',    land: 'New Orleans',     currentWait: 15, b0: 30, b1: 35, b3: 40, b4: 45, p10: 10, p90: 50, verdict: 'star' }), walkMinutes: 8, walkYards: 640 },
    { ride: makeRide({ id: 'matterhorn',     name: 'Matterhorn Bobsleds',         land: 'Fantasyland',     currentWait: 45, b0: 35, b1: 40, b3: 45, b4: 50, p10: 20, p90: 70, verdict: 'skip' }), walkMinutes: 9, walkYards: 720 },
    { ride: makeRide({ id: 'indy',           name: "Indiana Jones Adventure",     land: 'Adventureland',   currentWait: 40, b0: 45, b1: 50, b3: 55, b4: 60, p10: 25, p90: 80, verdict: 'go' }), walkMinutes: 7, walkYards: 560 },
    { ride: makeRide({ id: 'haunted-mansion',name: 'Haunted Mansion',             land: 'New Orleans',     currentWait: 25, b0: 35, b1: 40, b3: 50, b4: 55, p10: 15, p90: 70, verdict: 'go' }), walkMinutes: 8, walkYards: 640 },
    { ride: makeRide({ id: 'small-world',    name: "it's a small world",          land: 'Fantasyland',     currentWait: 5,  b0: 10, b1: 15, b3: 20, b4: 25, p10: 5,  p90: 30, verdict: 'star' }), walkMinutes: 10, walkYards: 800 },
    { ride: makeRide({ id: 'jungle-cruise',  name: 'Jungle Cruise',               land: 'Adventureland',   currentWait: 30, b0: 35, b1: 40, b3: 50, b4: 55, p10: 15, p90: 65, verdict: 'go' }), walkMinutes: 6, walkYards: 480 },
    { ride: makeRide({ id: 'rise-resistance',name: 'Rise of the Resistance',      land: 'Galaxy\'s Edge',  currentWait: 70, b0: 60, b1: 65, b3: 75, b4: 80, p10: 45, p90: 95, verdict: 'neutral' }), walkMinutes: 12, walkYards: 960 },
    { ride: makeRide({ id: 'autopia',        name: 'Autopia',                     land: 'Tomorrowland',    currentWait: 20, b0: 25, b1: 30, b3: 35, b4: 40, p10: 10, p90: 55, verdict: 'go' }), walkMinutes: 6, walkYards: 480 },
  ];

  const now = new Date();
  const codeMap = assignCodes(candidates);
  const lines = buildRideLines(codeMap, {
    persona: null,
    reopens: new Map(),
    anchorRideId: [...codeMap.values()][0].ride.id,   // nearest ride is the anchor
    now,
    timeZone: parkTimeZone('disneyland'),
  });
  const requestContext = buildRequestContext({
    parkSlug: 'disneyland',
    now,
    parkHours: { open: '08:00', close: '23:00' },
    lines,
    weather: null,
    batchSize: BATCH_SIZE,
  });
  const userMessage = buildUserMessage(requestContext, lines);

  console.log('=== USER MESSAGE ===');
  console.log(userMessage);
  console.log('');

  const systemBlocks = buildSystemPrompt(DEFAULT_PERSONA, BATCH_SIZE);
  console.log(`=== INVOKING BEDROCK (system as ${systemBlocks.length} text blocks) ===`);
  const { text, usage, stopReason, elapsedMs } = await invokeRecommendations(systemBlocks, userMessage);
  console.log(JSON.stringify({ stopReason, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, elapsedMs, textLen: text.length }));
  console.log('');

  console.log('=== RAW RESPONSE ===');
  console.log(text);
  console.log('');

  const parsed = parseAndValidate(text, codeMap, candidates, BATCH_SIZE);
  console.log('=== PARSED ===');
  console.log(`recs: ${parsed?.length ?? 'null'}`);
  if (parsed) {
    for (const r of parsed) {
      console.log(`  • [${r.rideId}] ${r.oneLiner}`);
    }
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
