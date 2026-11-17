// One-line current weather for the recommendations prompt (spec 6.12).
//
// Reads the newest doc the collector wrote to the resort's weather collection
// (collect.js fetchWeatherSnapshot). Cached per resort for 10 minutes, which
// matches the collector's cadence. Never throws; null means "omit the line".

import { getFirestore } from './firestoreClient';
import { TTLCache } from './cache';
import { ParkSlug } from './types';

/** Weather collection per park. A Record so a new park slug (e.g. WDW, which
 *  reads 'weather_snapshots_wdw') fails to compile until it is mapped. */
export const WEATHER_COLLECTIONS: Record<ParkSlug, string> = {
  'disneyland': 'weather_snapshots',
  'california-adventure': 'weather_snapshots',
};

const WEATHER_TTL_MS = 10 * 60_000;
/** A snapshot older than this is treated as missing (collector outage). */
export const WEATHER_MAX_AGE_MIN = 120;

const cache = new TTLCache<string, string | null>(WEATHER_TTL_MS);

/** WMO weather_code → short word. */
export function weatherWord(code: number | null | undefined): string {
  if (code == null || !Number.isFinite(code)) return 'conditions unknown';
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 95 && code <= 99) return 'thunderstorms';
  return 'conditions unknown';
}

interface WeatherDoc {
  timestamp_utc?: { toDate?: () => Date } | null;
  temperature_f?: number | null;
  feels_like_f?: number | null;
  weather_code?: number | null;
}

/** "88F, feels like 92, clear", or null when temperature is missing. */
export function formatWeatherLine(d: WeatherDoc): string | null {
  if (typeof d.temperature_f !== 'number' || !Number.isFinite(d.temperature_f)) return null;
  const parts = [`${Math.round(d.temperature_f)}F`];
  if (typeof d.feels_like_f === 'number' && Number.isFinite(d.feels_like_f)) {
    parts.push(`feels like ${Math.round(d.feels_like_f)}`);
  }
  parts.push(weatherWord(d.weather_code));
  return parts.join(', ');
}

export async function loadWeatherLine(parkSlug: ParkSlug, now: Date): Promise<string | null> {
  const collection = WEATHER_COLLECTIONS[parkSlug];
  if (!collection) return null;
  const hit = cache.get(collection);
  if (hit !== undefined) return hit;
  try {
    const snap = await getFirestore()
      .collection(collection)
      .orderBy('timestamp_utc', 'desc')
      .limit(1)
      .get();
    let line: string | null = null;
    snap.forEach(doc => {
      const d = doc.data() as WeatherDoc;
      const ts = d.timestamp_utc?.toDate?.();
      if (ts && now.getTime() - ts.getTime() > WEATHER_MAX_AGE_MIN * 60_000) return;
      line = formatWeatherLine(d);
    });
    cache.set(collection, line);
    return line;
  } catch (err) {
    console.warn('weather read failed; serving without weather', err);
    return null;
  }
}

/** Test helper. */
export function _clearWeatherCache(): void {
  cache.clear();
}
