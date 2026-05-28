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
  Ride,
  Recommendation,
  RecommendationsResponse,
} from '../types';
import { ensureRideMetadataLoaded, lookupRideMetadata } from './rideMetadata';
import { walkingMinutes, walkingYards } from './walkingDistance';
import { invokeRecommendations } from './bedrockClient';
import { buildUserMessage, SYSTEM_PROMPT, RideForPrompt } from './promptBuilder';
import { getParkHours } from './parkHours';

const DEFAULT_FALLBACK_ONE_LINER = 'Recommended based on current waits.';
const DEFAULT_FALLBACK_PARAGRAPH =
  "Our scoring system rates this ride positively given current waits, the typical line for this hour, and the projected trend over the next two hours.";

const TOTAL_RECS = 10;

export interface RecommendationsRequest {
  park: ParkSlug;
  currentRideId: string;
  /** Optional ISO timestamp for testing against historical/future ride
   *  states. Mirrors the /v0/waits `?at=` query param: when set, fetchPark
   *  uses it as the reference date (live feed still fetches real-time but
   *  scoring / day-type / current-time context are evaluated against `at`). */
  at?: Date;
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

  const currentMeta = lookupRideMetadata(metadataMap, req.currentRideId);
  const currentRideEntity = park.rides.find(r => r.id === req.currentRideId);

  // Candidate set: operating rides in the same park, excluding the user's
  // current ride. Carry walk minutes + yards per candidate.
  const candidates: RideForPrompt[] = park.rides
    .filter(r => r.status === 'OPERATING' && r.id !== req.currentRideId)
    .map(ride => {
      const otherMeta = lookupRideMetadata(metadataMap, ride.id);
      return {
        ride,
        walkMinutes: walkingMinutes(currentMeta, otherMeta),
        walkYards: walkingYards(currentMeta, otherMeta),
      };
    });

  // Empty park (closed, weather, etc.) → return an empty list. Not degraded,
  // just no rides to recommend.
  if (candidates.length === 0) {
    return {
      currentRide: shapeCurrentRide(req.park, req.currentRideId, currentRideEntity, currentMeta),
      park: req.park,
      lastUpdated: park.lastUpdated,
      degraded: false,
      recommendations: [],
    };
  }

  // Park hours: best-effort. If /schedule fails we serve recs without the
  // hours hint and the softened prompt handles "unknown" gracefully.
  const parkHours = await getParkHours(req.park, req.at ?? new Date());

  // Build the prompt context and try Bedrock.
  const ctx = {
    park: PARKS[req.park].name,
    currentRide: {
      id: req.currentRideId,
      name: currentRideEntity?.name ?? currentMeta?.name ?? 'Unknown',
    },
    currentLocalTime: formatLocalTime(req.at ?? new Date()),
    parkHours,
    rides: candidates,
  };

  let llmRecs: Recommendation[] | null = null;
  try {
    const text = await invokeRecommendations(SYSTEM_PROMPT, buildUserMessage(ctx));
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
    return {
      currentRide: shapeCurrentRide(req.park, req.currentRideId, currentRideEntity, currentMeta),
      park: req.park,
      lastUpdated: park.lastUpdated,
      degraded: true,
      recommendations: fallbackRecs(candidates),
    };
  }

  return {
    currentRide: shapeCurrentRide(req.park, req.currentRideId, currentRideEntity, currentMeta),
    park: req.park,
    lastUpdated: park.lastUpdated,
    degraded: false,
    recommendations: llmRecs,
  };
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
// Filters out recs whose rideId isn't in the candidate set. Caps at TOTAL_RECS.
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
    if (valid.length >= TOTAL_RECS) break;
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
 * Sorts candidates by score (descending), takes the top TOTAL_RECS, and
 * assigns a generic one-liner + paragraph.
 */
export function fallbackRecs(candidates: RideForPrompt[]): Recommendation[] {
  const sorted = [...candidates].sort((a, b) => {
    const sa = a.ride.score?.score ?? 0;
    const sb = b.ride.score?.score ?? 0;
    return sb - sa;
  });
  return sorted.slice(0, TOTAL_RECS).map(({ ride, walkMinutes, walkYards }) => ({
    rideId: ride.id,
    oneLiner: DEFAULT_FALLBACK_ONE_LINER,
    paragraph: DEFAULT_FALLBACK_PARAGRAPH,
    walkMinutes,
    walkYards,
    arrivalWait: null,
  }));
}
