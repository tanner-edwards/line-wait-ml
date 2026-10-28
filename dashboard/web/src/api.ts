import type { DayGrade } from './types';

const KEY_STORAGE = 'c32-admin-key';

export class UnauthorizedError extends Error {}

export function getKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Private mode / blocked storage: the key just won't persist across reloads.
  }
}

async function get(path: string, key: string): Promise<DayGrade> {
  const res = await fetch(path, { headers: { 'x-admin-key': key } });
  if (res.status === 401) throw new UnauthorizedError('Admin key rejected');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const fetchLive = (key: string) => get('/api/live', key);
export const fetchRecap = (key: string, date: string) => get(`/api/recap?date=${encodeURIComponent(date)}`, key);
