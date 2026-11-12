// Prompt variants: each experiment is a named, self-contained way of building the prompt
// (and, if it renames ride ids, decoding the answer). `baseline` is exactly what production
// sends today (it calls the real backend builders). A variant that wins gets ported into
// app/backend/src/recommendations/promptBuilder.ts (and handler.ts if parsing changes).
//
// Add a variant: write one object below and register it in VARIANTS. Then:
//   npm run bench -- --variant my-variant --runs 5
//   npm run compare -- <baseline results> <my-variant results>

import { buildSystemPrompt, buildUserMessage, PromptContext } from '../../app/backend/src/recommendations/promptBuilder';
import { BuiltScenario, ParsedRec } from './scenarios';

export interface Variant {
  id: string;
  description: string;
  buildSystem(persona: string, batchSize: number): string;
  buildUser(ctx: PromptContext, batchSize: number): string;
  /** Map ride ids in the model's answer back to real ids (only for variants that rename ids). */
  decode?(recs: ParsedRec[], b: BuiltScenario): ParsedRec[];
  /** Real ride id -> the id shown to the model (used by the dry-run self-test). */
  encodeId?(b: BuiltScenario, realId: string): string;
}

const baseline: Variant = {
  id: 'baseline',
  description: 'Exactly what production sends today.',
  buildSystem: buildSystemPrompt,
  buildUser: buildUserMessage,
};

// --- short-ids: r1..rN instead of 36-character UUIDs --------------------------------------
// Hypothesis: UUIDs are ~1/3 of the output tokens and the source of garbled-id errors.
const code = (i: number) => `r${i + 1}`;
const shortIds: Variant = {
  id: 'short-ids',
  description: 'Rides are labeled r1..rN instead of UUIDs (fewer output tokens, no garbled ids).',
  buildSystem: (persona, n) => buildSystemPrompt(persona, n).replace('<UUID from the ride list>', '<ride code from the list, like r3>'),
  buildUser: (ctx, n) =>
    buildUserMessage({
      ...ctx,
      currentRide: { ...ctx.currentRide, id: 'r0' },
      rides: ctx.rides.map((rf, i) => ({ ...rf, ride: { ...rf.ride, id: code(i) } })),
    }, n),
  decode: (recs, b) => recs.map(r => {
    const m = /^r(\d+)$/.exec(r.rideId);
    const real = m ? b.candidates[Number(m[1]) - 1]?.ride.id : undefined;
    return { ...r, rideId: real ?? r.rideId }; // unknown codes stay as-is so the checks flag them
  }),
  encodeId: (b, realId) => code(b.candidates.findIndex(c => c.ride.id === realId)),
};

// --- tight-copy: stricter caption rules + examples ----------------------------------------
// Starting point from the first evaluations: captions ran long, restated numbers, and made
// claims the data didn't support. Expect to iterate on this wording together.
const TIGHT_COPY_BLOCK = `WRITING THE COPY (oneLiner):
- HARD LIMIT: 70 characters or fewer. Shorter is better.
- Write like a knowledgeable friend giving a quick tip, not a system explaining its output.
- Add the "why now" that the card cannot show. You MAY use a relative comparison ("half its usual line", "shortest it has been all day"), but do NOT quote raw minutes, the ride name, or the walk time: the card already shows them.
- Only say what the data supports. Never call a wait "short" or "minimal" unless it is clearly below that ride's usual wait.
- Never mention internal terms: badge, star, go, score, verdict, projection.
- When a ride jumps ahead of closer options, say why it is worth the extra walk.
Good captions: "Half its usual line, rare chance at a headliner" / "Closest good option, and the line is shrinking" / "Evening crowds build here, grab it before dinner" / "Gentle dark ride, an easy win with little ones".
Bad captions (do NOT write): "Great ride with only a 25 minute wait!" (restates the wait) / "Big Thunder Mountain is a classic" (restates the name, adds nothing).

HARD RULES`;
const tightCopy: Variant = {
  id: 'tight-copy',
  description: 'Stricter caption rules (70 chars, relative comparisons allowed, grounded claims) with good/bad examples.',
  buildSystem: (persona, n) => buildSystemPrompt(persona, n).replace(/WRITING THE COPY \(oneLiner\):[\s\S]*?\n\nHARD RULES/, TIGHT_COPY_BLOCK),
  buildUser: buildUserMessage,
};

export const VARIANTS: Record<string, Variant> = Object.fromEntries([baseline, shortIds, tightCopy].map(v => [v.id, v]));

export function getVariant(id: string): Variant {
  const v = VARIANTS[id];
  if (!v) throw new Error(`Unknown variant "${id}". Available: ${Object.keys(VARIANTS).join(', ')}`);
  return v;
}
