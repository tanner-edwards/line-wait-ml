import admin from 'firebase-admin';
import { holidayFeatures } from './holidays.js';
import { loadEvents, localEventFeatures } from './local_events.js';

const API_BASE = 'https://api.themeparks.wiki/v1';

function buildWeatherUrl(latitude, longitude, timezone) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'mm',
    timezone,
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

const RESORTS = [
  {
    id: 'DLR',
    name: 'Disneyland Resort',
    timezone: 'America/Los_Angeles',
    weatherUrl: buildWeatherUrl(33.8121, -117.9190, 'America/Los_Angeles'),
    waitCollection: 'wait_times',
    weatherCollection: 'weather_snapshots',
    eventsFile: './local_events.json',
    parks: [
      { id: '7340550b-c14d-4def-80bb-acdb51d49a66', name: 'Disneyland Park' },
      { id: '832fcd51-ea19-4e77-85c7-75d5843b127c', name: 'Disney California Adventure Park' },
    ],
  },
  {
    id: 'WDW',
    name: 'Walt Disney World Resort',
    timezone: 'America/New_York',
    weatherUrl: buildWeatherUrl(28.39, -81.57, 'America/New_York'),
    waitCollection: 'wait_times_wdw',
    weatherCollection: 'weather_snapshots_wdw',
    eventsFile: './local_events_wdw.json',
    parks: [
      { id: '75ea578a-adc8-4116-a54d-dccb60765ef9', name: 'Magic Kingdom Park' },
      { id: '47f90d2c-e191-4239-a466-5892ef59a88b', name: 'EPCOT' },
      { id: '288747d1-8b4f-4a64-867e-ea7c9b27bad8', name: "Disney's Hollywood Studios" },
      { id: '1c84a229-8862-4648-9c71-378ddd2c7693', name: "Disney's Animal Kingdom Theme Park" },
    ],
  },
];

function log(event, extra = {}) {
  console.log(JSON.stringify({ event, ...extra }));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function currentScheduleWindow(park, now) {
  let data;
  try {
    data = await fetchJson(`${API_BASE}/entity/${park.id}/schedule`);
  } catch (err) {
    // Fail open: assume the park might be open and let the live fetch reveal
    // closures via per-ride status. Better than a data gap on transient API blips.
    console.warn(JSON.stringify({ event: 'schedule_fetch_failed', park: park.name, error: String(err) }));
    return { type: 'UNKNOWN' };
  }
  const t = now.getTime();
  for (const entry of data.schedule || []) {
    if (entry.type !== 'OPERATING' && entry.type !== 'TICKETED_EVENT') continue;
    const open = Date.parse(entry.openingTime);
    const close = Date.parse(entry.closingTime);
    if (Number.isFinite(open) && Number.isFinite(close) && t >= open && t <= close) {
      return { type: entry.type };
    }
  }
  return null;
}

function temporalParts(now, timezone) {
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const hourFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  });
  const [y, m, d] = dateFmt.format(now).split('-').map(Number);
  const hour = Number(hourFmt.format(now).replace(/[^\d]/g, ''));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { month: m, hour, dow };
}

function stripForecast(entity) {
  // The forecast array adds ~15 hourly rows per ride to every snapshot.
  // We snapshot wait time directly; storing Disney's own forecast would
  // ~3x the doc size for limited extra signal.
  const { forecast, ...rest } = entity;
  return rest;
}

async function fetchWeatherSnapshot(now, weatherUrl) {
  const data = await fetchJson(weatherUrl);
  const c = data.current;
  if (!c) throw new Error('weather response missing `current`');
  return {
    timestamp_utc: now,
    temperature_f: c.temperature_2m ?? null,
    feels_like_f: c.apparent_temperature ?? null,
    precipitation_mm: c.precipitation ?? null,
    wind_mph: c.wind_speed_10m ?? null,
    weather_code: c.weather_code ?? null,
    raw: data,
  };
}

function buildSnapshot(entity, park, now, parts, feats, eventFeats) {
  return {
    ride_id: entity.id,
    ride_name: entity.name,
    park_id: park.id,
    park_name: park.name,
    wait_minutes: entity.queue?.STANDBY?.waitTime ?? null,
    status: entity.status ?? 'UNKNOWN',
    timestamp_utc: now,
    schedule_type: park.scheduleType,
    day_of_week: parts.dow,
    hour_of_day: parts.hour,
    month: parts.month,
    is_holiday: feats.is_holiday,
    is_holiday_weekend: feats.is_holiday_weekend,
    days_until_next_holiday: feats.days_until_next_holiday,
    days_since_last_holiday: feats.days_since_last_holiday,
    local_event_today: eventFeats.local_event_today,
    local_event_types: eventFeats.local_event_types,
    local_event_names: eventFeats.local_event_names,
    days_until_next_local_event: eventFeats.days_until_next_local_event,
    days_since_last_local_event: eventFeats.days_since_last_local_event,
    raw: stripForecast(entity),
  };
}

// Idempotent — admin.initializeApp() throws if called twice, so we cache after first call.
let firestoreInstance = null;
function getFirestore() {
  if (firestoreInstance) return firestoreInstance;
  const blob = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!blob) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(blob)) });
  firestoreInstance = admin.firestore();
  return firestoreInstance;
}

async function batchWrite(collection, rows) {
  const db = collection.firestore;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = db.batch();
    for (const row of rows.slice(i, i + 500)) {
      batch.set(collection.doc(), row);
    }
    await batch.commit();
  }
}

async function collectResort(resort, now) {
  // 1. Schedule gate per park in this resort
  const openParks = [];
  for (const park of resort.parks) {
    const window = await currentScheduleWindow(park, now);
    if (window) openParks.push({ ...park, scheduleType: window.type });
  }
  if (openParks.length === 0) {
    log('skip_closed', { resort: resort.id, at: now.toISOString() });
    return;
  }

  // 2. Live wait times + weather, in parallel
  const liveFetches = openParks.map(async park => ({
    park,
    data: await fetchJson(`${API_BASE}/entity/${park.id}/live`),
  }));
  const weatherFetch = fetchWeatherSnapshot(now, resort.weatherUrl).catch(err => {
    console.warn(JSON.stringify({ event: 'weather_fetch_failed', resort: resort.id, error: String(err) }));
    return null;
  });
  const [live, weather] = await Promise.all([Promise.all(liveFetches), weatherFetch]);

  // 3. Build snapshot rows using this resort's timezone + events file
  const parts = temporalParts(now, resort.timezone);
  const feats = holidayFeatures(now, resort.timezone);
  const eventFeats = localEventFeatures(now, loadEvents(resort.eventsFile), resort.timezone);
  const rows = live.flatMap(({ park, data }) =>
    (data.liveData || [])
      .filter(e => e.entityType === 'ATTRACTION' && e.queue)
      .map(e => buildSnapshot(e, park, now, parts, feats, eventFeats))
  );

  if (rows.length === 0) {
    log('no_attractions', { resort: resort.id, parks: openParks.map(p => p.name) });
    return;
  }

  // 4. Write to this resort's collections
  const db = getFirestore();
  await batchWrite(db.collection(resort.waitCollection), rows);
  if (weather) {
    await db.collection(resort.weatherCollection).add(weather);
  }
  log('wrote', {
    resort: resort.id,
    count: rows.length,
    parks: openParks.map(p => p.name),
    weather: weather ? 'ok' : 'skipped',
  });
}

async function run() {
  const now = new Date();
  let anyFailure = false;
  for (const resort of RESORTS) {
    try {
      await collectResort(resort, now);
    } catch (err) {
      anyFailure = true;
      console.error(JSON.stringify({
        event: 'resort_failed',
        resort: resort.id,
        error: String(err),
        stack: err?.stack,
      }));
    }
  }
  if (anyFailure) process.exit(1);
}

run().catch(err => {
  console.error(JSON.stringify({ event: 'error', error: String(err), stack: err?.stack }));
  process.exit(1);
});
