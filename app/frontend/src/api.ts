import {
  CombinedResponse,
  ErrorResponse,
  ParkSlug,
  Persona,
  RecommendationsResponse,
} from './types';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';

export class ApiError extends Error {
  constructor(public readonly statusCode: number | null, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchWaits(at?: string): Promise<CombinedResponse> {
  if (!BASE_URL || !API_KEY) {
    throw new ApiError(null, 'API base URL or key not configured');
  }

  const url = at
    ? `${BASE_URL}/v0/waits?at=${encodeURIComponent(at)}`
    : `${BASE_URL}/v0/waits`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'x-api-key': API_KEY },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    throw new ApiError(null, message);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ErrorResponse;
      detail = body.message || body.error || detail;
    } catch {
      // body wasn't JSON — fall back to status code
    }
    throw new ApiError(res.status, detail);
  }

  return (await res.json()) as CombinedResponse;
}

interface FetchRecommendationsInput {
  park: ParkSlug;
  /** User's GPS coordinates (or debug-mode fake coordinates). */
  userLat: number;
  userLng: number;
  /** Optional v3 persona — backend defaults to its built-in persona when null. */
  persona?: Persona | null;
  /** Ride IDs the client already has from a previous batch. Used by the
   *  "show more" flow so the next call doesn't return the same picks. */
  excludeRideIds?: string[];
  /** Optional AbortSignal so the Recommendations screen can cancel an in-
   *  flight call when the user re-picks before the previous call returns. */
  signal?: AbortSignal;
}

export async function fetchRecommendations({
  park,
  userLat,
  userLng,
  persona,
  excludeRideIds,
  signal,
}: FetchRecommendationsInput): Promise<RecommendationsResponse> {
  if (!BASE_URL || !API_KEY) {
    throw new ApiError(null, 'API base URL or key not configured');
  }

  const body: Record<string, unknown> = { park, userLat, userLng };
  if (persona) body.persona = persona;
  if (excludeRideIds && excludeRideIds.length > 0) body.excludeRideIds = excludeRideIds;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/v2/recommendations`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err; // let the caller distinguish cancellation from real failure
    }
    const message = err instanceof Error ? err.message : 'Network error';
    throw new ApiError(null, message);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ErrorResponse;
      detail = body.message || body.error || detail;
    } catch {
      // body wasn't JSON — fall back to status code
    }
    throw new ApiError(res.status, detail);
  }

  return (await res.json()) as RecommendationsResponse;
}
