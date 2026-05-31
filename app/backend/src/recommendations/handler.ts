// /v2/recommendations orchestrator.
//
// Flow:
//   1. fetchPark for the requested park (reuses Slice A's scored response)
//   2. lookup ride_metadata for current ride + every candidate
//   3. compute walking minutes from current → each candidate
//   4. filter to operating rides, exclude current ride
//   5. build prompt + invoke Bedrock
//   6. parse + validate JSON response
//   7. on any failure → deterministic fallback (top-10 by score, generic prose)

import { fetchPark } from '../handler';
import {
  ParkSlug,
  PARKS,
  Persona,
  Ride,
  RideMetadata,
  Recommendation,
  RecommendationsResponse,
} from '../types';
import { ensureRideMetadataLoaded, lookupRideMetadata } from './rideMetadata';
import { haversineMeters, walkingMinutes, walkingYards } from './walkingDistance';
import { invokeRecommendations } from './bedrockClient';
import { buildSystemPrompt, buildUserMessage, RideForPrompt } from './promptBuilder';
import { personaToText } from './persona';
import { getParkHours } from './parkHours';

const DEFAULT_FALLBACK_ONE_LINER = 'Recommended based on current waits.';
const DEFAULT_FALLBACK_PARAGRAPH =
  "Our scoring system rates this ride positively given current waits, the typical line for this hour, and the projected trend over the next two hours.";

/** Recommendations are batched: each call returns up to BATCH_SIZE picks.
 *  The client fires a second call with excludeRideIds when the user taps
 *  "show more" to fetch the next batch. Halves the LLM latency vs. asking
 *  for 10 upfront. */
export const BATCH_SIZE = 5;

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
  const park = await fetchPark(req.park, req.at);

  let metadataMap;
  try {
    metadataMap = await ensureRideMetadataLoaded();
  } catch (err) {
    console.warn('ride_metadata load failed; serving without walk distances', err);
    metadataMap = new Map();
  }

  // Derive the nearest ride to the user's GPS position — used as the LLM
  // "current ride" anchor and excluded from the candidate pool.
  const nearest = findNearestRide(req.userLat, req.userLng, metadataMap, park.rides);
  const currentRideId = nearest?.id ?? '';
  const currentRideEntity = park.rides.find(r => r.id === currentRideId);
  const userCoords = { lat: req.userLat, lng: req.userLng };

  // Candidate set: operating rides in the same park, excluding the nearest
  // ride AND any ride IDs the client says it already has from a prior batch.
  const excluded = new Set([currentRideId, ...(req.excludeRideIds ?? [])].filter(Boolean));
  const candidates: RideForPrompt[] = park.rides
    .filter(r => r.status === 'OPERATING' && !excluded.has(r.id))
    .map(ride => {
      const otherMeta = lookupRideMetadata(metadataMap, ride.id);
      return {
        ride,
        walkMinutes: walkingMinutes(userCoords, otherMeta),
        walkYards: walkingYards(userCoords, otherMeta),
      };
    });

  // Empty candidate pool (park closed, all rides already shown, etc.) →
  // return an empty list. Not degraded, just no rides to recommend.
  if (candidates.length === 0) {
    return {
      currentRide: shapeCurrentRide(req.park, currentRideId, currentRideEntity, nearest),
      park: req.park,
      lastUpdated: park.lastUpdated,
      degraded: false,
      recommendations: [],
      hasMore: false,
    };
  }

  // Park hours: best-effort. If /schedule fails we serve recs without the
  // hours hint and the softened prompt handles "unknown" gracefully.
  const parkHours = await getParkHours(req.park, req.at ?? new Date());

  // Build the prompt context and try Bedrock.
  const ctx = {
    park: PARKS[req.park].name,
    currentRide: {
      id: currentRideId,
      name: currentRideEntity?.name ?? nearest?.name ?? 'Unknown',
    },
    currentLocalTime: formatLocalTime(req.at ?? new Date()),
    parkHours,
    rides: candidates,
  };

  // Build system prompt fresh per request so the persona block reflects the
  // calling user. When persona is null/empty, personaToText returns the
  // DEFAULT_PERSONA text and we get the same prompt v2 used.
  const systemPrompt = buildSystemPrompt(personaToText(req.persona, metadataMap), BATCH_SIZE);

  let llmRecs: Recommendation[] | null = null;
  try {
    const text = await invokeRecommendations(systemPrompt, buildUserMessage(ctx, BATCH_SIZE));
    // TEMP DEBUG (remove once Bedrock path is verified): log the raw model
    // response so we can tell whether a degraded result came from a parse
    // failure vs an empty rec list vs all-filtered IDs.
    console.log('[bedrock-raw]', JSON.stringify({ textLen: text.length, preview: text.slice(0, 400) }));
    llmRecs = parseAndValidate(text, candidates);
    console.log('[bedrock-parsed]', JSON.stringify({ count: llmRecs?.length ?? null }));
  } catch (err) {
    console.warn('Bedrock call failed; falling back to deterministic recs', err);
  }

  if (llmRecs === null || llmRecs.length === 0) {
    const recs = fallbackRecs(candidates);
    return {
      currentRide: shapeCurrentRide(req.park, currentRideId, currentRideEntity, nearest),
      park: req.park,
      lastUpdated: park.lastUpdated,
      degraded: true,
      recommendations: recs,
      hasMore: candidates.length > recs.length,
    };
  }

  return {
    currentRide: shapeCurrentRide(req.park, currentRideId, currentRideEntity, nearest),
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

// LA wall-clock time formatted as "Friday 11:32 AM" for the LLM context.
function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

// Strict JSON validator. Rejects anything not matching the contract.
// Filters out recs whose rideId isn't in the candidate set. Caps at BATCH_SIZE.
export function parseAndValidate(
  text: string,
  candidates: RideForPrompt[]
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

  const candidateIds = new Set(candidates.map(c => c.ride.id));
  const walkLookup = new Map(
    candidates.map(c => [c.ride.id, { minutes: c.walkMinutes, yards: c.walkYards }])
  );

  const valid: Recommendation[] = [];
  for (const entry of recs) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.rideId !== 'string') continue;
    if (typeof e.oneLiner !== 'string') continue;
    if (typeof e.paragraph !== 'string') continue;
    if (!candidateIds.has(e.rideId)) continue;
    const walk = walkLookup.get(e.rideId);
    const arrivalWait = typeof e.arrivalWait === 'number' && Number.isFinite(e.arrivalWait)
      ? Math.round(e.arrivalWait)
      : null;
    valid.push({
      rideId: e.rideId,
      oneLiner: e.oneLiner,
      paragraph: e.paragraph,
      walkMinutes: walk?.minutes ?? null,
      walkYards: walk?.yards ?? null,
      arrivalWait,
    });
    if (valid.length >= BATCH_SIZE) break;
  }
  return valid;
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
 * Sorts candidates by score (descending), takes the top BATCH_SIZE, and
 * assigns a generic one-liner + paragraph.
 */
export function fallbackRecs(candidates: RideForPrompt[]): Recommendation[] {
  const sorted = [...candidates].sort((a, b) => {
    const sa = a.ride.score?.score ?? 0;
    const sb = b.ride.score?.score ?? 0;
    return sb - sa;
  });
  return sorted.slice(0, BATCH_SIZE).map(({ ride, walkMinutes, walkYards }) => ({
    rideId: ride.id,
    oneLiner: DEFAULT_FALLBACK_ONE_LINER,
    paragraph: DEFAULT_FALLBACK_PARAGRAPH,
    walkMinutes,
    walkYards,
    arrivalWait: null,
  }));
}
