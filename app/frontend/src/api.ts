import { CombinedResponse, ErrorResponse } from './types';

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
