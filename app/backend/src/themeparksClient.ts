import { ParkSlug, PARKS, ThemeparksLiveResponse, ThemeparksScheduleResponse } from './types';

const API_BASE = 'https://api.themeparks.wiki/v1';

export class UpstreamError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new UpstreamError(
      res.status,
      `Themeparks API returned ${res.status} for ${url}`
    );
  }
  return (await res.json()) as T;
}

export async function fetchLiveData(
  parkSlug: ParkSlug
): Promise<ThemeparksLiveResponse> {
  const parkId = PARKS[parkSlug].id;
  return fetchJson<ThemeparksLiveResponse>(
    `${API_BASE}/entity/${parkId}/live`
  );
}

export async function fetchSchedule(
  parkSlug: ParkSlug
): Promise<ThemeparksScheduleResponse> {
  const parkId = PARKS[parkSlug].id;
  return fetchJson<ThemeparksScheduleResponse>(
    `${API_BASE}/entity/${parkId}/schedule`
  );
}
