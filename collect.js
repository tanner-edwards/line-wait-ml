import admin from 'firebase-admin';
import { holidayFeatures } from './holidays.js';

const API_BASE = 'https://api.themeparks.wiki/v1';

const PARKS = [
  { id: '7340550b-c14d-4def-80bb-acdb51d49a66', name: 'Disneyland Park' },
  { id: '832fcd51-ea19-4e77-85c7-75d5843b127c', name: 'Disney California Adventure Park' },
];

const PT_TZ = 'America/Los_Angeles';
const PT_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: PT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const PT_HOUR_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: PT_TZ,
  hour: '2-digit',
  hour12: false,
});

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

function ptParts(now) {
  const [y, m, d] = PT_DATE_FMT.format(now).split('-').map(Number);
  const hour = Number(PT_HOUR_FMT.format(now).replace(/[^\d]/g, ''));
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

function buildSnapshot(entity, park, now, parts, feats) {
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
    raw: stripForecast(entity),
  };
}

function initFirestore() {
  const blob = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!blob) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(blob)) });
  return admin.firestore();
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

async function run() {
  const now = new Date();

  const openParks = [];
  for (const park of PARKS) {
    const window = await currentScheduleWindow(park, now);
    if (window) openParks.push({ ...park, scheduleType: window.type });
  }
  if (openParks.length === 0) {
    log('skip_closed', { at: now.toISOString() });
    return;
  }

  const live = await Promise.all(
    openParks.map(async park => ({ park, data: await fetchJson(`${API_BASE}/entity/${park.id}/live`) }))
  );

  const parts = ptParts(now);
  const feats = holidayFeatures(now);
  const rows = live.flatMap(({ park, data }) =>
    (data.liveData || [])
      .filter(e => e.entityType === 'ATTRACTION' && e.queue)
      .map(e => buildSnapshot(e, park, now, parts, feats))
  );

  if (rows.length === 0) {
    log('no_attractions', { parks: openParks.map(p => p.name) });
    return;
  }

  const db = initFirestore();
  await batchWrite(db.collection('wait_times'), rows);
  log('wrote', { count: rows.length, parks: openParks.map(p => p.name) });
}

run().catch(err => {
  console.error(JSON.stringify({ event: 'error', error: String(err), stack: err?.stack }));
  process.exit(1);
});
