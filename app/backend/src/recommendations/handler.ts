// /v2/recommendations orchestrator.
//
// Flow:
//   1. fetchPark for the requested park (reuses Slice A's scored response)
//   2. lookup ride_metadata for the nearest ride + every candidate
//   3. compute walking minutes from the guest to each candidate
//   4. candidate pool: operating rides, minus excludeRideIds, minus rides the
//      guest cannot reach before close. The nearest ride (the "Near X" anchor)
//      and skip verdicts stay in the pool; the prompt owns those stories.
//   5. load park hours, recent reopens, weather in parallel (best-effort)
//   6. build RideLine[] + RequestContext (buildPromptInputs.ts), assign codes
//   7. build prompt + invoke Bedrock
//   8. parse + validate JSON response (codes mapped back to UUIDs)
//   9. on any failure → deterministic fallback (verdict tier, then walk)

import { fetchPark, parkCacheIsFreshEnough } from '../handler';
import {
  ParkData,
  ParkSlug,
  Persona,
  Ride,
  RideMetadata,
  Recommendation,
  RecommendationsResponse,
} from '../types';
import { ensureRideMetadataLoaded, lookupRideMetadata } from './rideMetadata';
import { haversineMeters, walkingMinutes, walkingYards } from './walkingDistance';
import { invokeRecommendations } from './bedrockClient';
import { buildSystemPrompt, buildUserMessage } from './promptBuilder';
import { personaToText } from './persona';
import { getParkHours, ParkHours } from './parkHours';
import { loadRecentReopens } from '../recentReopens';
import { loadWeatherLine } from '../weather';
import { RequestContext, RideForPrompt, RideLine } from './promptInputs';
import {
  applySkipGate,
  assignCodes,
  buildRequestContext,
  buildRideLines,
  computeArrivalWait,
  minutesUntilClose,
  normalizeRideName,
  parkTimeZone,
  reachableBeforeClose,
} from './buildPromptInputs';

const DEFAULT_FALLBACK_ONE_LINER = 'Recommended based on current waits.';
// [DROPPED] Paragraph fallback string. Removed alongside the LLM paragraph
// field to halve output tokens. Restore when paragraph comes back as an
// on-demand fetch. See promptBuilder.ts TODO(paragraph).
// const DEFAULT_FALLBACK_PARAGRAPH =
//   "Our scoring system rates this ride positively given current waits, the typical line for this hour, and the projected trend over the next two hours.";

/** Recommendations are batched: each call returns up to `count` picks
 *  (DEFAULT_BATCH_SIZE when the client doesn't ask for a specific amount).
 *  The client fires a second call with excludeRideIds when the user taps
 *  "show more" to fetch the next batch. Halves the LLM latency vs. asking
 *  for 10 upfront. */
export const DEFAULT_BATCH_SIZE = 5;
/** Upper bound on a client-requested `count`. Keeps LLM output (and latency)
 *  well inside bedrockClient's MAX_TOKENS cap. */
export const MAX_BATCH_SIZE = 8;

/** Clamp a requested batch size into [1, MAX_BATCH_SIZE]; undefined → default. */
export function resolveBatchSize(count?: number): number {
  if (count === undefined || !Number.isFinite(count)) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(count)));
}

export interface RecommendationsRequest {
  park: ParkSlug;
  /** GPS coordinates of the user. Backend derives the nearest ride as the
   *  "current ride" anchor for the LLM and as the walking-distance origin. */
  userLat: number;
  userLng: number;
  /** Optional ISO timestamp for testing against historical/future ride
   *  states. Mirrors the /v0/waits `?at=` query param: when set, fetchPark
   *  uses it as the reference date (live feed still fetches real-time but
   *  scoring / day-type / current-time context are evaluated against `at`). */
  at?: Date;
  /** Optional v3 persona. When provided, it's translated to natural language
   *  and inlined into the LLM system prompt. When omitted (or null) we fall
   *  back to DEFAULT_PERSONA, preserving v2 behavior. */
  persona?: Persona | null;
  /** Optional list of ride UUIDs to exclude from the candidate pool. Used
   *  by the "show more" flow so the second batch doesn't repeat picks from
   *  the first. */
  excludeRideIds?: string[];
  /** Optional max number of recommendations to return. Defaults to
   *  DEFAULT_BATCH_SIZE (5); clamped to [1, MAX_BATCH_SIZE]. */
  count?: number;
}

type NearestRide = { id: string; name: string; lat: number; lng: number };

/** Everything the prompt needs, built before any Bedrock call. Exported so
 *  scripts/dump-prompt-inputs.ts runs the exact same path. */
export interface RecommendationInputs {
  park: ParkData;
  metadataMap: Map<string, RideMetadata>;
  batchSize: number;
  nearest: NearestRide | null;
  currentRideId: string;
  currentRideEntity: Ride | undefined;
  /** Candidate pool in code order (r1 first). Empty → nothing to recommend. */
  candidates: RideForPrompt[];
  /** code → candidate, for mapping model output back to UUIDs. */
  codeMap: Map<string, RideForPrompt>;
  lines: RideLine[];
  /** True when unwanted skip rides were removed from the pool (under SKIP_POOL_FRACTION skip). */
  skipGated: boolean;
  requestContext: RequestContext;
  /** ms spent on the park fetch and side loads, for the [recs-timing] log. */
  loadMs: number;
  parkHours: ParkHours | null;
  now: Date;
}

export async function prepareRecommendationInputs(
  req: RecommendationsRequest
): Promise<RecommendationInputs> {
  const batchSize = resolveBatchSize(req.count);
  const now = req.at ?? new Date();
  const tz = parkTimeZone(req.park);

  // Every load starts at once. The park fetch forces fresh data only when the
  // cached park is older than FRESH_ENOUGH_MS (the waits tab usually filled it
  // seconds earlier; a forced refetch cost 2-4 s per call in production). Hours, reopens, weather
  // and metadata do not depend on the park, so they no longer wait for it.
  // Each side load is best-effort: a failure degrades the prompt, never the request.
  const t0 = Date.now();
  const [park, metadataMap, parkHours, reopens, weather] = await Promise.all([
    fetchPark(req.park, req.at, null, null, !parkCacheIsFreshEnough(req.park)),
    ensureRideMetadataLoaded().catch((err): Map<string, RideMetadata> => {
      console.warn('ride_metadata load failed; serving without walk distances', err);
      return new Map();
    }),
    getParkHours(req.park, now).catch(() => null),
    loadRecentReopens(now).catch(() => new Map<string, number>()),
    loadWeatherLine(req.park, now).catch(() => null),
  ]);
  const loadMs = Date.now() - t0;

  // Nearest ride to the user's GPS position: the "Near X" header ride and the
  // anchor line in the prompt. It stays in the candidate pool (spec 6.10).
  const nearest = findNearestRide(req.userLat, req.userLng, metadataMap, park.rides);
  const currentRideId = nearest?.id ?? '';
  const currentRideEntity = park.rides.find(r => r.id === currentRideId);
  const userCoords = { lat: req.userLat, lng: req.userLng };

  // Operating rides minus the ones the client already has from a prior batch.
  // Skip verdicts stay in: the prompt decides when a skip ride is still the
  // right move (bad field, wanted ride) and how to say so (spec 6.11).
  const excluded = new Set((req.excludeRideIds ?? []).filter(Boolean));
  const operating: RideForPrompt[] = park.rides
    .filter(r => r.status === 'OPERATING' && !excluded.has(r.id))
    .map(ride => {
      const otherMeta = lookupRideMetadata(metadataMap, ride.id);
      return {
        ride,
        walkMinutes: walkingMinutes(userCoords, otherMeta, otherMeta?.walkPenaltyMinutes ?? 0),
        walkYards: walkingYards(userCoords, otherMeta),
      };
    });

  const empty = (): RecommendationInputs => ({
    park, metadataMap, batchSize, nearest, currentRideId, currentRideEntity,
    candidates: [], codeMap: new Map(), lines: [],
    requestContext: buildRequestContext({ parkSlug: req.park, now, parkHours, lines: [], weather: null, batchSize }),
    parkHours, now, loadMs, skipGated: false,
  });

  // Park closed, all rides already shown, etc. → nothing to recommend.
  if (operating.length === 0) return empty();

  // Rides the guest cannot walk to before close leave the pool (spec 6.7).
  const untilClose = minutesUntilClose(parkHours, now, tz);
  const reachable = operating.filter(c => reachableBeforeClose(c.walkMinutes, untilClose));
  if (reachable.length === 0) return empty();

  // Skip-verdict rides leave the pool unless the day is bad (spec 6.11 amendment).
  const { pool, gated: skipGated } = applySkipGate(reachable, req.persona);
  if (pool.length === 0) return empty();

  const codeMap = assignCodes(pool);
  const lines = buildRideLines(codeMap, {
    persona: req.persona,
    reopens,
    anchorRideId: currentRideId || null,
    now,
    timeZone: tz,
  });
  const requestContext = buildRequestContext({ parkSlug: req.park, now, parkHours, lines, weather, batchSize });

  return {
    park, metadataMap, batchSize, nearest, currentRideId, currentRideEntity,
    candidates: [...codeMap.values()],
    codeMap, lines, requestContext, parkHours, now, loadMs, skipGated,
  };
}

/**
 * Build a RecommendationsResponse for the given (park, currentRideId).
 * Always returns a 200-shaped response — Bedrock failure flips `degraded`
 * to true and falls back to deterministic top-N. The caller wraps this in
 * the API Gateway response envelope.
 */
export async function buildRecommendations(
  req: RecommendationsRequest
): Promise<RecommendationsResponse> {
  const tStart = Date.now();
  const inputs = await prepareRecommendationInputs(req);
  const { park, metadataMap, batchSize, nearest, currentRideId, currentRideEntity, candidates, codeMap } = inputs;
  const currentRide = shapeCurrentRide(req.park, currentRideId, currentRideEntity, nearest);

  // Empty candidate pool (park closed, all rides already shown, nothing
  // reachable before close) → empty list. Not degraded, just nothing to recommend.
  if (candidates.length === 0) {
    return {
      currentRide,
      park: req.park,
      lastUpdated: park.lastUpdated,
      degraded: false,
      recommendations: [],
      hasMore: false,
    };
  }

  // Build system prompt fresh per request so the persona block (last block)
  // reflects the calling user. When persona is null/empty, personaToText
  // returns DEFAULT_PERSONA.
  const systemPrompt = buildSystemPrompt(personaToText(req.persona, metadataMap), batchSize);
  const userMessage = buildUserMessage(inputs.requestContext, inputs.lines);

  let llmRecs: Recommendation[] | null = null;
  try {
    const { text, usage, stopReason, elapsedMs } = await invokeRecommendations(systemPrompt, userMessage);
    // Stage timing: where a slow /v2/recommendations spends its time.
    console.log('[recs-timing]', JSON.stringify({ loadMs: inputs.loadMs, bedrockMs: elapsedMs, totalMs: Date.now() - tStart }));
    // TEMP DEBUG (remove once Bedrock path is verified): log the raw model
    // response so we can tell whether a degraded result came from a parse
    // failure vs an empty rec list vs all-filtered IDs.
    console.log('[bedrock-raw]', JSON.stringify({
      textLen: text.length,
      outputTokens: usage.outputTokens,
      inputTokens: usage.inputTokens,
      stopReason,
      elapsedMs,
      preview: text.slice(0, 400),
    }));
    llmRecs = guardSkipLast(guardRankOne(parseAndValidate(text, codeMap, candidates, batchSize), inputs.lines), inputs.lines, inputs.skipGated);
    console.log('[bedrock-parsed]', JSON.stringify({ count: llmRecs?.length ?? null }));
  } catch (err) {
    console.warn('Bedrock call failed; falling back to deterministic recs', err);
  }

  if (llmRecs === null || llmRecs.length === 0) {
    const recs = fallbackRecs(candidates, batchSize);
    return {
      currentRide,
      park: req.park,
      lastUpdated: park.lastUpdated,
      degraded: true,
      recommendations: recs,
      hasMore: candidates.length > recs.length,
    };
  }

  return {
    currentRide,
    park: req.park,
    lastUpdated: park.lastUpdated,
    degraded: false,
    recommendations: llmRecs,
    hasMore: candidates.length > llmRecs.length,
  };
}

/** Returns the ride in `parkRides` whose metadata coordinates are closest
 *  to (userLat, userLng). Rides without coordinates in ride_metadata are
 *  skipped. Returns null only when no ride has coordinates at all. */
export function findNearestRide(
  userLat: number,
  userLng: number,
  metadataMap: Map<string, RideMetadata>,
  parkRides: Ride[]
): { id: string; name: string; lat: number; lng: number } | null {
  const parkRideIds = new Set(parkRides.map(r => r.id));
  let best: { id: string; name: string; lat: number; lng: number; dist: number } | null = null;
  for (const [rideId, meta] of metadataMap) {
    if (!parkRideIds.has(rideId)) continue;
    if (meta.lat === null || meta.lng === null) continue;
    const dist = haversineMeters(userLat, userLng, meta.lat, meta.lng);
    if (best === null || dist < best.dist) {
      best = { id: rideId, name: meta.name, lat: meta.lat, lng: meta.lng, dist };
    }
  }
  return best ? { id: best.id, name: best.name, lat: best.lat, lng: best.lng } : null;
}

function shapeCurrentRide(
  parkSlug: ParkSlug,
  id: string,
  rideEntity: Ride | undefined,
  meta: { lat: number | null; lng: number | null; name: string } | null
) {
  return {
    id,
    name: rideEntity?.name ?? meta?.name ?? 'Unknown',
    park: parkSlug,
    lat: meta?.lat ?? null,
    lng: meta?.lng ?? null,
  };
}

const CODE_RE = /^(r\d+)\b\s*[:.\-]?\s*(.*)$/is;

/**
 * Map one model `rideId` to a pool candidate, or null to drop the entry.
 * Accepted forms:
 *   - a bare UUID present in the pool (UUID-output prompt variant);
 *   - "<code> <name>" (spec 5): the name must match the code's ride after
 *     normalizeRideName on both sides;
 *   - a bare code.
 * The exact-UUID check runs first so a pool id can never be misread as a code.
 */
export function resolveRideRef(
  raw: string,
  codeMap: Map<string, RideForPrompt>,
  byId: Map<string, RideForPrompt>,
): RideForPrompt | null {
  const ref = raw.trim();
  const direct = byId.get(ref);
  if (direct) return direct;
  const m = CODE_RE.exec(ref);
  if (!m) return null;
  const candidate = codeMap.get(m[1].toLowerCase());
  if (!candidate) return null;
  const name = m[2].trim();
  if (name === '') return candidate;
  return normalizeRideName(name) === normalizeRideName(candidate.ride.name) ? candidate : null;
}

// Strict JSON validator. Rejects anything not matching the contract.
// Maps each rideId (code plus name, bare code, or pool UUID) back to a pool
// ride; drops unknown codes, name mismatches, and repeat rides. Caps at
// batchSize. arrivalWait is computed server-side via computeArrivalWait — the
// LLM value is ignored to prevent naive currentWait+walkMinutes arithmetic.
export function parseAndValidate(
  text: string,
  codeMap: Map<string, RideForPrompt>,
  candidates: RideForPrompt[],
  batchSize: number = DEFAULT_BATCH_SIZE
): Recommendation[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const root = parsed as Record<string, unknown>;
  const recs = root.recommendations;
  if (!Array.isArray(recs)) return null;

  const byId = new Map(candidates.map(c => [c.ride.id, c]));
  const seen = new Set<string>();

  const valid: Recommendation[] = [];
  for (const entry of recs) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.rideId !== 'string') continue;
    if (typeof e.oneLiner !== 'string') continue;
    // [DROPPED] paragraph field check + assignment removed to halve LLM
    // output tokens. Restore when paragraph comes back as an on-demand
    // fetch. See promptBuilder.ts TODO(paragraph).
    // if (typeof e.paragraph !== 'string') continue;
    const candidate = resolveRideRef(e.rideId, codeMap, byId);
    if (!candidate) continue;
    if (seen.has(candidate.ride.id)) continue;
    seen.add(candidate.ride.id);
    valid.push({
      rideId: candidate.ride.id,
      oneLiner: cleanCopy(e.oneLiner),
      restrictionNote: typeof e.restrictionNote === 'string' ? cleanCopy(e.restrictionNote) : null,
      // paragraph: e.paragraph,
      walkMinutes: candidate.walkMinutes,
      walkYards: candidate.walkYards,
      arrivalWait: computeArrivalWait(
        candidate.ride.currentWait,
        candidate.walkMinutes,
        candidate.ride.historicalAverage ?? null,
      ),
    });
    if (valid.length >= batchSize) break;
  }
  return valid;
}

// Deterministic guard for hard rule 11 (spec section 8): rank 1 is never a ride
// someone in the party cannot ride unless the guest wanted it. Haiku 4.5 puts
// the biggest deal first regardless of the rule (S1: a star-verdict Indiana
// Jones with a pregnant guest led 5 of 5 runs), so the server promotes the
// first pick everyone can ride. Captions are untouched; order is the only
// change, and only when the model broke the rule.
export function guardRankOne<T extends { rideId: string }>(recs: T[] | null, lines: RideLine[]): T[] | null {
  if (!recs || recs.length < 2) return recs;
  const byId = new Map(lines.map(l => [l.rideId, l]));
  const blocked = (r: T) => { const l = byId.get(r.rideId); return !!l && l.restricted.length > 0 && !l.wanted; };
  if (!blocked(recs[0])) return recs;
  const i = recs.findIndex(r => !blocked(r));
  if (i < 0) return recs;
  console.log('[rank-guard]', JSON.stringify({ demoted: recs[0].rideId, promoted: recs[i].rideId }));
  return [recs[i], ...recs.slice(0, i), ...recs.slice(i + 1)];
}

// Deterministic guard for the skip gate: when unwanted skips were removed from
// the pool, any (wanted) skip-verdict pick ranks after every non-skip pick.
// Stable, so the model's order within each group is kept.
export function guardSkipLast<T extends { rideId: string }>(recs: T[] | null, lines: RideLine[], gated: boolean): T[] | null {
  if (!gated || !recs || recs.length < 2) return recs;
  const skip = new Set(lines.filter(l => l.verdict === 'skip').map(l => l.rideId));
  const keep = recs.filter(r => !skip.has(r.rideId));
  const last = recs.filter(r => skip.has(r.rideId));
  if (last.length === 0 || keep.length === 0) return recs;
  if (keep.every((r, i) => recs[i] === r)) return recs;
  console.log('[skip-guard]', JSON.stringify({ movedLast: last.map(r => r.rideId) }));
  return [...keep, ...last];
}

// Deterministic guard for two copy rules Haiku breaks even when told not to
// (spec section 9): em/en dashes become a comma, exclamation marks a period.
// Collapses doubled spaces the substitution can leave behind.
export function cleanCopy(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    // "You wanted this one" reads as blame (Tanner, 2026-11-17); Haiku keeps
    // writing it despite the hard rule, so it becomes "one you had your eye on".
    .replace(/\b(y)ou (?:still )?want(?:ed)? this(?: one| ride)?\b/gi, (_m, y: string) => `${y === 'Y' ? 'O' : 'o'}ne you had your eye on`)
    .replace(/!+/g, '.')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// The model is told not to wrap output in ```json ... ``` fences, but if it
// does anyway we strip them so the JSON.parse still works.
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

/**
 * Deterministic fallback when Bedrock fails or returns garbage.
 * Sorts candidates by score (descending), takes the top batchSize, and
 * assigns a generic one-liner.
 */
export function fallbackRecs(
  candidates: RideForPrompt[],
  batchSize: number = DEFAULT_BATCH_SIZE
): Recommendation[] {
  // No LLM: rank by verdict (star > go > neutral > skip), then shorter walk.
  const RANK: Record<string, number> = { star: 3, go: 2, neutral: 1, skip: 0 };
  const rank = (r: RideForPrompt) => RANK[r.ride.verdict?.verdict ?? 'neutral'] ?? 1;
  const sorted = [...candidates].sort((a, b) => {
    const d = rank(b) - rank(a);
    if (d !== 0) return d;
    return (a.walkMinutes ?? Infinity) - (b.walkMinutes ?? Infinity);
  });
  return sorted.slice(0, batchSize).map(({ ride, walkMinutes, walkYards }) => ({
    rideId: ride.id,
    oneLiner: DEFAULT_FALLBACK_ONE_LINER,
    restrictionNote: null,
    // paragraph: DEFAULT_FALLBACK_PARAGRAPH,  // [DROPPED] see promptBuilder.ts TODO(paragraph)
    walkMinutes,
    walkYards,
    arrivalWait: computeArrivalWait(ride.currentWait, walkMinutes, ride.historicalAverage ?? null),
  }));
}
