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

const metadataMap = (b: BuiltFixture) => new Map<string, RideMetadata>(b.rides.map(r => [r.id, { rideId: r.id, parkId: b.fx.park, name: r.name, lat: null, lng: null, source: 'manual' } as RideMetadata]));

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

export const VARIANTS: Record<string, Variant> = { v1 };

export function getVariant(id: string): Variant {
  const v = VARIANTS[id];
  if (!v) throw new Error(`Unknown variant "${id}". Available: ${Object.keys(VARIANTS).join(', ')}`);
  return v;
}
