import { readFileSync } from 'fs';
import { join } from 'path';
// Prompt variants. A variant turns a fixture into the exact system prompt + user message a given
// version of the server would send, and maps the model's ids back to rides.
//
//   v1   = production before the 2026-11-16 spec (frozen copy in prompts/v1/). Reproduces the old
//          handler too: the anchor ride and skip-verdict rides are removed before the model sees them.
//
// When the spec rewrite lands in app/backend/src/recommendations, add two variants that import the
// NEW backend builder (spec §10 asks for both and compares them):
//   spec-uuid   the new prompt, model outputs UUIDs
//   spec-codes  the new prompt, model outputs "r3 Big Thunder Mountain Railroad" (use decodeCodeName)
// Each needs only a render() that builds the backend's input from the fixture. Then:
//   npm run eval -- --variant spec-codes

import { Ride, RideMetadata } from '../../app/backend/src/types';
import { ParsedRec } from './parse';
import { personaToText as v1PersonaToText } from './prompts/v1/persona';
import { buildSystemPrompt as v1System, buildUserMessage as v1User, PromptContext as V1Context } from './prompts/v1/promptBuilder';
import { BuiltFixture, DerivedRide, ResolvedRec } from './types';
import { BATCH } from './checks';
// The spec rewrite (2026-11-17): the live backend's prompt and input builders.
import { buildSystemPrompt as specSystem, buildUserMessage as specUser } from '../../app/backend/src/recommendations/promptBuilder';
import { personaToText as specPersonaToText } from '../../app/backend/src/recommendations/persona';
import { buildSystemPromptIntent, buildUserMessageIntent } from '../../app/backend/src/recommendations/promptIntent';
import { applySkipGate, assignCodes, buildRequestContext, buildRideLines, parkTimeZone } from '../../app/backend/src/recommendations/buildPromptInputs';
import { IdStyle } from '../../app/backend/src/recommendations/promptInputs';
import { cleanCopy, guardRankOne, guardSkipLast } from '../../app/backend/src/recommendations/handler';

export interface Rendered {
  system: string;
  user: string;
  /** Ride names actually offered to the model. */
  offered: string[];
  decode(raw: ParsedRec[]): ResolvedRec[];
}
export interface Variant { id: string; description: string; render(b: BuiltFixture): Rendered }

const PARK_NAME = { 'disneyland': 'Disneyland', 'california-adventure': 'Disney California Adventure' } as const;

/** A backend `Ride` object for a fixture ride, as the waits pipeline would build it. */
export function toBackendRide(r: DerivedRide): Ride {
  const usual = r.usual ?? r.wait;
  const slope = r.buckets[1] - r.buckets[0];
  return {
    id: r.id, name: r.name, land: r.land, status: 'OPERATING', currentWait: r.wait,
    historicalAverage: { dayType: 'weekend', buckets: r.buckets.map((wait, i) => ({ offsetMinutes: i * 30, timeSlot: 'n/a', wait, sampleCount: 30 })) },
    rideStats: { p10: r.p10 ?? Math.round(usual * 0.5), p50: usual, p90: r.p90 ?? Math.round(usual * 1.6), sampleCount: 200 },
    prediction: { trend: slope <= -5 ? 'falling' : slope >= 5 ? 'rising' : 'stable', confidence: 'medium' },
    recentHistory: null, lat: null, lng: null, closedAt: null,
    heightMinIn: r.heightMinIn, thrillLevel: r.thrillLevel, pregnancyAdvisory: r.pregnancyAdvisory, transferRequired: r.transferRequired,
    verdict: {
      verdict: r.verdict,
      reasons: {
        primary: r.reason ?? 'none', current: r.wait, typical: r.usual, todayP30: null, todayP80: null,
        p10: r.p10 ?? Math.round(usual * 0.5), p90: r.p90 ?? Math.round(usual * 1.6),
        beatableSoon: !!r.window, betterWindowWait: r.window?.wait ?? null, betterWindowInMin: r.window?.inMin ?? null, star: r.verdict === 'star',
      },
    },
  } as unknown as Ride;
}

// Ride facts (queue type, water, thrill, duration, notes) come from the repo's ride_metadata.json by
// name, the same source the Firestore seeder reads, so fixtures carry what the Lambda sees.
const RIDE_FACTS: Map<string, Record<string, unknown>> = (() => {
  try {
    const raw = JSON.parse(readFileSync(join(__dirname, '..', '..', 'ride_metadata.json'), 'utf8')) as unknown;
    const arr = (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown[]>).flat()) as Record<string, unknown>[];
    return new Map(arr.map(r => [String(r.name), r]));
  } catch { return new Map(); }
})();
const metadataMap = (b: BuiltFixture) => new Map<string, RideMetadata>(b.rides.map(r => {
  const f = RIDE_FACTS.get(r.name);
  return [r.id, {
    rideId: r.id, parkId: b.fx.park, name: r.name, lat: null, lng: null, source: 'manual',
    thrillLevel: (f?.thrill_level as number | undefined) ?? r.thrillLevel ?? null,
    queueType: (f?.queue_type as string | undefined) ?? null,
    waterRide: (f?.water_ride as boolean | undefined) ?? false,
    durationMin: (f?.duration_min as number | undefined) ?? null,
    notes: (f?.notes as string | undefined) ?? null,
  } as RideMetadata];
}));

const byId = (b: BuiltFixture) => new Map(b.rides.map(r => [r.id, r.name]));

const v1: Variant = {
  id: 'v1',
  description: 'Production prompt before the 2026-11-16 spec (UUID ids, anchor and skip rides removed).',
  render(b) {
    const candidates = b.rides.filter(r => !r.isAnchor && r.verdict !== 'skip');
    const anchor = b.rides.find(r => r.isAnchor)!;
    const ctx: V1Context = {
      park: PARK_NAME[b.fx.park],
      currentRide: { id: anchor.id, name: anchor.name },
      currentLocalTime: b.fx.localTime,
      parkHours: b.fx.hours,
      rides: candidates.map(r => ({ ride: toBackendRide(r), walkMinutes: r.walk, walkYards: r.walk * 90 })),
    };
    const ids = byId(b);
    return {
      system: v1System(v1PersonaToText(b.persona, metadataMap(b)), BATCH),
      user: v1User(ctx, BATCH),
      offered: candidates.map(r => r.name),
      decode: raw => raw.map(x => ({ ride: ids.get(x.rideId.trim()) ?? null, rawId: x.rideId, oneLiner: x.oneLiner, restrictionNote: x.restrictionNote })),
    };
  },
};

/** Spec §5: "r3 Big Thunder Mountain Railroad" -> ride, only when the name matches that code's ride. */
export function decodeCodeName(raw: ParsedRec[], codes: Map<string, string>): ResolvedRec[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return raw.map(x => {
    const m = /^\s*(r\d+)\b\s*(.*)$/i.exec(x.rideId);
    const ride = m ? codes.get(m[1].toLowerCase()) : undefined;
    const ok = ride && (!m![2] || norm(m![2]) === norm(ride));
    return { ride: ok ? ride! : null, rawId: x.rideId, oneLiner: x.oneLiner, restrictionNote: x.restrictionNote };
  });
}

/** A Date for the fixture's weekday + nowMin in the park's zone. Fixtures name a weekday
 *  ("Saturday 1:30 PM"); any date with that weekday will do. Uses November 2026 (PST, UTC-8). */
function fixtureNow(b: BuiltFixture): Date {
  const weekday = b.fx.localTime.split(' ')[0];
  const tz = parkTimeZone(b.fx.park);
  for (let d = 15; d < 22; d++) {
    const midnightUtc = Date.UTC(2026, 10, d, 8, 0, 0); // 00:00 PST
    const probe = new Date(midnightUtc + 12 * 60 * 60_000);
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(probe);
    if (name === weekday) return new Date(midnightUtc + b.fx.nowMin * 60_000);
  }
  throw new Error(`fixture ${b.fx.id}: cannot place weekday "${weekday}"`);
}

/** The spec rewrite, rendered exactly as app/backend builds it from the same fixture. */
function renderSpec(b: BuiltFixture, idStyle: IdStyle, prompt: 'rules' | 'intent' = 'rules'): Rendered {
  const anchor = b.rides.find(r => r.isAnchor)!;
  const now = fixtureNow(b);
  const candidates = b.rides
    .filter(r => r.reachableBeforeClose)
    .map(r => ({ ride: toBackendRide(r), walkMinutes: r.walk, walkYards: r.walk * 90 }));
  // The Lambda's skip gate: unwanted skip rides leave the pool unless the day is bad.
  const { pool, gated: skipGated } = applySkipGate(candidates, b.persona);
  const codeMap = assignCodes(pool);
  const reopens = new Map<string, number>();
  for (const r of b.rides) if (r.minutesSinceReopen != null) reopens.set(r.id, r.minutesSinceReopen);
  const lines = buildRideLines(codeMap, {
    persona: b.persona, metadata: metadataMap(b), reopens, anchorRideId: anchor.id, now, timeZone: parkTimeZone(b.fx.park),
  });
  const weather = b.fx.weather ? `${b.fx.weather.tempF}F, feels like ${b.fx.weather.feelsF}, ${b.fx.weather.conditions}` : null;
  const ctx = buildRequestContext({ parkSlug: b.fx.park, now, parkHours: b.fx.hours, lines, weather, batchSize: BATCH });
  const codes = new Map(lines.map(l => [l.code, l.name]));
  const ids = byId(b);
  return {
    system: (prompt === 'intent' ? buildSystemPromptIntent : specSystem)(specPersonaToText(b.persona, metadataMap(b)), BATCH, { idStyle }).join('\n\n'),
    user: (prompt === 'intent' ? buildUserMessageIntent : specUser)(ctx, lines, { idStyle }),
    offered: lines.map(l => l.name),
    // The Lambda's parser runs cleanCopy (dashes to commas, "!" to ".") on every
    // caption and guardRankOne (a restricted, unwanted ride never leads) on the
    // order before the app sees it, so the harness grades the shipped result.
    decode: raw => {
      const resolved = idStyle === 'code'
        ? decodeCodeName(raw.map(x => ({ ...x, oneLiner: cleanCopy(x.oneLiner), restrictionNote: x.restrictionNote == null ? x.restrictionNote : cleanCopy(x.restrictionNote) })), codes)
        : raw.map(x => ({ ride: ids.get(x.rideId.trim()) ?? null, rawId: x.rideId, oneLiner: cleanCopy(x.oneLiner), restrictionNote: x.restrictionNote == null ? null : cleanCopy(x.restrictionNote) }));
      const idByName = new Map(lines.map(l => [l.name, l.rideId]));
      const keyed = resolved.map(r => ({ ...r, rideId: (r.ride && idByName.get(r.ride)) ?? `?${r.rawId}` }));
      return (guardSkipLast(guardRankOne(keyed, lines), lines, skipGated) ?? keyed).map(({ rideId: _drop, ...rest }: typeof keyed[number]) => rest);
    },
  };
}

const specCodes: Variant = {
  id: 'spec-codes',
  description: 'Spec rewrite (2026-11-17): new prompt and inputs, model outputs "r3 Ride Name".',
  render: b => renderSpec(b, 'code'),
};

const specUuid: Variant = {
  id: 'spec-uuid',
  description: 'Spec rewrite (2026-11-17): same prompt and inputs, model outputs UUIDs.',
  render: b => renderSpec(b, 'uuid'),
};

const intentCodes: Variant = {
  id: 'intent-codes',
  description: 'Intent prompt (2026-11-18): same inputs and output, rules replaced by intent; written for Haiku 5.5.',
  render: b => renderSpec(b, 'code', 'intent'),
};

export const VARIANTS: Record<string, Variant> = { v1, 'spec-codes': specCodes, 'spec-uuid': specUuid, 'intent-codes': intentCodes };

export function getVariant(id: string): Variant {
  const v = VARIANTS[id];
  if (!v) throw new Error(`Unknown variant "${id}". Available: ${Object.keys(VARIANTS).join(', ')}`);
  return v;
}
