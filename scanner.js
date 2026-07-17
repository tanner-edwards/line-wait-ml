// Notification scanner. Runs every 10 minutes from the same GitHub Actions
// workflow that powers collect.js, immediately after the collector finishes
// writing the latest snapshot to wait_times. The scanner:
//
//   1. Reads the latest wait_times tick + ride_stats + historical_averages
//   2. Reads armed devices (notificationsEnabled=true, armedDate=today PT)
//   3. For each (device, must-do ride): scores it; if gold-star or "go"
//      condition fires AND we're within park hours AND not in cooldown,
//      writes a notification_log entry.
//
// Phase B1 (this commit) is DRY RUN — no actual pushes are sent. Phase B2
// adds Web Push delivery on top of the notification_log writes.
//
// The hard rule that `collect.js only writes` is preserved: the scanner is
// a separate module/file. The scoring logic is intentionally duplicated
// from app/backend/src/scoring/score.ts (~80 lines of pure math). A future
// refactor can extract scoring into a shared local package consumed by
// both the Lambda and the scanner.

import admin from 'firebase-admin';
import webpush from 'web-push';
import { notificationTitle, notificationBody, formatDuration } from './notification-copy.js';

const PARK_TZ = 'America/Los_Angeles';

// Minimum bucket0 sampleCount before scoring is considered trustworthy.
// Raised from 1 → 10 on 2026-06-07 (~36 days of data). Raise toward 20
// around 2026-07-07 once weekend counts reach ~60 samples/bucket.
// Keep in sync with: app/backend/src/scoring/score.ts MIN_BUCKET_SAMPLE_COUNT,
//                    app/frontend/src/scoreConstants.ts MIN_BUCKET_SAMPLE_COUNT
const MIN_BUCKET_SAMPLE_COUNT = 10;

// Disneyland Resort park UUIDs (match collect.js + backend/src/types.ts).
// historical_averages and ride_stats docs are keyed by these IDs.
const DLR_PARK_IDS = [
  '7340550b-c14d-4def-80bb-acdb51d49a66', // Disneyland Park
  '832fcd51-ea19-4e77-85c7-75d5843b127c', // Disney California Adventure
];
const PARK_ID_BY_SLUG = {
  'disneyland': '7340550b-c14d-4def-80bb-acdb51d49a66',
  'california-adventure': '832fcd51-ea19-4e77-85c7-75d5843b127c',
};

// Resolve the set of park UUIDs a device cares about today. 'both' (or
// missing — older device records that pre-date this field) means no
// filter; the user is treated as a park-hopper.
function allowedParkIdsFor(device) {
  const dp = device.dailyParks;
  if (!dp || dp === 'both') return DLR_PARK_IDS;
  const id = PARK_ID_BY_SLUG[dp];
  return id ? [id] : DLR_PARK_IDS;
}

// Per-type opt-in check. Legacy records without a notificationTypes object
// default to true for trough/closure/reopen (preserving v1 behavior), but
// peak defaults to false everywhere — it's a new opt-in type.
function wantsNotification(device, type) {
  const types = device.notificationTypes;
  if (!types || typeof types !== 'object') return type !== 'peak';
  if (typeof types[type] !== 'boolean') return type !== 'peak';
  return types[type];
}

// --- logging + firestore singleton (mirrors collect.js) ---

function log(event, extra = {}) {
  console.log(JSON.stringify({ event, ...extra }));
}

let firestoreInstance = null;
function getFirestore() {
  if (firestoreInstance) return firestoreInstance;
  const blob = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!blob) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(blob)) });
  firestoreInstance = admin.firestore();
  return firestoreInstance;
}

// VAPID setup for Web Push. Skipped (push sends become dry-runs) if any of
// the three secrets are missing — useful for local debugging without keys.
let pushReady = false;
function initWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    log('vapid_missing', {
      publicKey: !!publicKey, privateKey: !!privateKey, subject: !!subject,
    });
    return;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  pushReady = true;
}

// --- date / bucket helpers (ported from app/backend/src/bucketing.ts and dayType.ts) ---

const DAY_MS = 86_400_000;

function pad2(n) { return String(n).padStart(2, '0'); }

function todayInPT(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARK_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(now);
}

function bucketOf(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARK_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const h = Number(parts.find(p => p.type === 'hour').value);
  const m = Number(parts.find(p => p.type === 'minute').value);
  const startMin = m < 30 ? 0 : 30;
  const endMin = startMin === 0 ? 30 : 0;
  const endH = startMin === 0 ? h : (h + 1) % 24;
  return `${pad2(h)}:${pad2(startMin)}-${pad2(endH)}:${pad2(endMin)}`;
}

function bucketsAroundNow(now) {
  const at = offsetMin => bucketOf(new Date(now.getTime() + offsetMin * 60_000));
  return [at(0), at(30), at(60), at(90), at(120), at(150)];
}

// Day-type classifier — kept in sync by hand with app/backend/src/dayType.ts
// and holidays.js at repo root. Three copies of this list is a known cost.
function calendarDayUTC(now) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARK_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [y, m, d] = fmt.format(now).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function dateUTC(y, m, d) { return Date.UTC(y, m - 1, d); }
function addDays(ts, n) { return ts + n * DAY_MS; }
function dowUTC(ts) { return new Date(ts).getUTCDay(); }
function nthWeekday(y, m, weekday, n) {
  const first = dateUTC(y, m, 1);
  const offset = (weekday - dowUTC(first) + 7) % 7;
  return dateUTC(y, m, 1 + offset + (n - 1) * 7);
}
function lastWeekday(y, m, weekday) {
  const firstNext = dateUTC(y, m + 1, 1);
  const last = addDays(firstNext, -1);
  const offset = (dowUTC(last) - weekday + 7) % 7;
  return addDays(last, -offset);
}
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const M = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * M + 114) / 31);
  const day = ((h + l - 7 * M + 114) % 31) + 1;
  return dateUTC(year, month, day);
}
function holidaysForYear(y) {
  const thx = nthWeekday(y, 11, 4, 4);
  return [
    dateUTC(y, 1, 1),
    nthWeekday(y, 1, 1, 3),
    nthWeekday(y, 2, 1, 3),
    easter(y),
    nthWeekday(y, 5, 0, 2),
    lastWeekday(y, 5, 1),
    nthWeekday(y, 6, 0, 3),
    dateUTC(y, 6, 19),
    dateUTC(y, 7, 4),
    nthWeekday(y, 9, 1, 1),
    nthWeekday(y, 10, 1, 2),
    dateUTC(y, 11, 11),
    thx,
    addDays(thx, 1),
    dateUTC(y, 12, 24),
    dateUTC(y, 12, 25),
    dateUTC(y, 12, 26),
    dateUTC(y, 12, 31),
  ];
}
function classifyDayType(now) {
  const today = calendarDayUTC(now);
  const year = new Date(today).getUTCFullYear();
  const allHols = new Set([
    ...holidaysForYear(year - 1),
    ...holidaysForYear(year),
    ...holidaysForYear(year + 1),
  ]);
  if (allHols.has(today)) return 'holiday';
  const dow = dowUTC(today);
  return (dow >= 1 && dow <= 4) ? 'weekday' : 'weekend';
}

// --- scoring (ported from app/backend/src/scoring/score.ts) ---

// Piecewise linear curve that scales the "is this delta meaningful?" floor
// with typical wait. MUST match absoluteFloorForTypical in score.ts so
// Browse badges and notifications agree on what counts as a real drop/rise.
//   typical ≤ 20  → 5 min
//   typical = 50  → 10 min
//   typical = 90  → 15 min
//   typical ≥ 120 → 20 min (capped)
// Between anchors the floor interpolates linearly (e.g. typical=40 → 8.3).
function absoluteFloorForTypical(typical) {
  if (typical <= 20)  return 5;
  if (typical <= 50)  return 5  + (typical - 20) / 30 * 5;
  if (typical <= 90)  return 10 + (typical - 50) / 40 * 5;
  if (typical <= 120) return 15 + (typical - 90) / 30 * 5;
  return 20;
}

// Returns 'star' | 'go' | 'skip' | null. Only 'star' and 'go' fire alerts.
function scoreRide(ride) {
  const { currentWait, status, historicalAverage, rideStats } = ride;
  if (currentWait === null || status !== 'OPERATING') return null;

  // Absolute floor override (from spec): a non-trivial ride sitting at
  // walk-on territory is an opportunity, regardless of badge logic. The
  // p90 >= 15 guard excludes chronic walk-on rides whose p90 stays low —
  // railroad, Casey Jr, walkthroughs — while still alerting on rides that
  // *can* get busy (Dumbo, Pirates, Indy etc.) when they hit a trough.
  // Bypasses the projDelta requirements of the badge logic so this fires
  // even near park close when the model expects a further drop.
  if (rideStats && rideStats.p90 >= 15 && currentWait <= 10) {
    return 'star';
  }

  if (!historicalAverage) return null;

  const [b0, b1, , b3, b4] = historicalAverage.buckets;
  if (b0.sampleCount < MIN_BUCKET_SAMPLE_COUNT) return null;

  // Factor 1: current vs t+0 bucket average (±2). Absolute-difference
  // floor scales with typical wait — see absoluteFloorForTypical() below.
  let vsAvgDelta = null, f1 = 0;
  if (b0.wait !== null && b0.wait !== 0) {
    vsAvgDelta = (currentWait - b0.wait) / b0.wait;
    if (Math.abs(currentWait - b0.wait) >= absoluteFloorForTypical(b0.wait)) {
      if      (vsAvgDelta < -0.25) f1 = +2;
      else if (vsAvgDelta < -0.10) f1 = +1;
      else if (vsAvgDelta >  0.25) f1 = -2;
      else if (vsAvgDelta >  0.10) f1 = -1;
    }
  }

  // Factor 2: position in p10/p90 range (±2)
  let f2 = 0;
  if (rideStats) {
    const range = rideStats.p90 - rideStats.p10;
    if (range >= 5) {
      const pct = Math.max(0, Math.min(1, (currentWait - rideStats.p10) / range));
      if      (currentWait <= rideStats.p10) f2 = +2;
      else if (pct < 0.25)                    f2 = +1;
      else if (currentWait >= rideStats.p90)  f2 = -2;
      else if (pct > 0.75)                    f2 = -1;
    }
  }

  // Factor 3: projected change, early window vs late window (±2)
  let projDelta = null, f3 = 0;
  const earlyAvg = b1.wait !== null ? (currentWait + b1.wait) / 2 : currentWait;
  const lateAvg  = (b3.wait !== null && b4.wait !== null) ? (b3.wait + b4.wait) / 2 : (b3.wait ?? b4.wait);
  if (currentWait !== 0 && lateAvg !== null) {
    projDelta = (lateAvg - earlyAvg) / earlyAvg;
    if (Math.abs(lateAvg - earlyAvg) >= 10) {
      if      (projDelta < -0.25) f3 = -2;
      else if (projDelta < -0.10) f3 = -1;
      else if (projDelta >  0.25) f3 = +2;
      else if (projDelta >  0.10) f3 = +1;
    }
  }

  // Factor 4: near-term change, current → t+30 (±1)
  let f4 = 0;
  if (b1.wait !== null && currentWait > 0) {
    const minuteDelta = b1.wait - currentWait;
    const threshold = Math.max(10, currentWait * 0.20);
    if (Math.abs(minuteDelta) >= threshold) {
      f4 = minuteDelta > 0 ? +1 : -1;
    }
  }

  const score = f1 + f2 + f3 + f4;

  // Rapid change: ≥40% swing from the previous OPERATING snapshot overrides
  // score-based badge assignment. Guard: previousStatus must be 'OPERATING'
  // to exclude reopen-from-DOWN (where 0 → 45 min looks like a huge spike).
  const prev = ride.recentHistory?.[0] ?? null;
  const previousWait   = prev?.wait   ?? null;
  const previousStatus = prev?.status ?? null;
  let isRapidDrop  = false;
  let isRapidSpike = false;
  if (previousWait !== null && previousWait > 0 && previousStatus === 'OPERATING') {
    const delta   = (currentWait - previousWait) / previousWait;
    const absDiff = Math.abs(currentWait - previousWait);
    if (absDiff >= 10) {
      isRapidDrop  = delta <= -0.40;
      isRapidSpike = delta >= +0.40;
    }
  }

  const isGoldStar =
    rideStats &&
    rideStats.p50 >= 25 &&
    currentWait <= rideStats.p10 * 1.15 &&
    vsAvgDelta !== null && vsAvgDelta < -0.30;

  if (isGoldStar) return 'star';
  if (isRapidDrop) return 'go';
  if (score >= 2) return (projDelta !== null && projDelta < -0.30) ? null : 'go';
  if (isRapidSpike || score <= -2) return 'skip';
  return null;
}

// --- firestore reads ---

// Reads recent wait_times. The query covers the last 25 minutes — enough
// for two ticks (collect.js writes every 10 min). Returns a map per ride
// of { current, previous } where each is { ts, parkId, rideId, name,
// status, wait } or `previous` is null if only one tick was found.
// `current` is the most-recent observation; `previous` is the second-
// most-recent. Used by both trough scoring (current only) and closure /
// reopen detection (current vs previous status diff).
async function readLatestSnapshot(db) {
  const since = new Date(Date.now() - 25 * 60_000);
  const snap = await db.collection('wait_times')
    .where('timestamp_utc', '>=', since)
    .get();
  const byRide = new Map();
  snap.forEach(doc => {
    const d = doc.data();
    // timestamp_utc may be a Firestore Timestamp or an ISO string depending
    // on how the doc was written.
    const ts = d.timestamp_utc?.toMillis
      ? d.timestamp_utc.toMillis()
      : new Date(d.timestamp_utc).getTime();
    const observation = {
      ts,
      parkId: d.park_id,
      rideId: d.ride_id,
      name: d.ride_name,
      status: d.status,
      wait: d.wait_minutes,
    };
    const existing = byRide.get(d.ride_id);
    if (!existing) {
      byRide.set(d.ride_id, { current: observation, previous: null });
    } else if (ts > existing.current.ts) {
      existing.previous = existing.current;
      existing.current = observation;
    } else if (!existing.previous || ts > existing.previous.ts) {
      existing.previous = observation;
    }
  });
  return byRide;
}

async function loadHistoricalAverages(db) {
  const snap = await db.collection('historical_averages').get();
  const map = new Map();
  snap.forEach(doc => {
    const d = doc.data();
    map.set(`${d.parkId}__${d.rideId}__${d.bucket}__${d.dayType}`, {
      wait: d.mean,
      sampleCount: d.sampleCount,
    });
  });
  return map;
}

async function loadRideStats(db) {
  const snap = await db.collection('ride_stats').get();
  const map = new Map();
  snap.forEach(doc => {
    const d = doc.data();
    // ride_stats docs written before p50 was added (early cron runs) are
    // missing that field. Fall back to the midpoint of p10/p90 — matches
    // the same defensive logic the backend's rideStats.ts uses.
    const p10 = d.p10 ?? 0;
    const p90 = d.p90 ?? 0;
    const p50 = d.p50 ?? Math.round((p10 + p90) / 2);
    map.set(`${d.parkId}__${d.rideId}__${d.dayType}`, {
      p10, p50, p90, sampleCount: d.sampleCount ?? 0,
    });
  });
  return map;
}

// current_closures/ holds one doc per ride that's currently DOWN. Doc ID
// is the rideId; the doc records when it went down. On reopen we read
// closedAt to compute downtime, then delete the doc.
async function recordClosureStart(db, current) {
  await db.collection('current_closures').doc(current.rideId).set({
    parkId: current.parkId,
    rideId: current.rideId,
    rideName: current.name,
    closedAt: new Date().toISOString(),
    waitAtClose: current.wait ?? null,
  });
}

// Appends a compact closure summary to closure_events/{auto-id}.
// This collection is what build_closure_profiles.py reads instead of a CSV.
async function recordClosureEvent(db, { rideId, rideName, parkId, closedAt, durationMin, waitAtClose, waitAtReopen, dayType, hourAtReopen, dayOfWeek }) {
  const delta = (waitAtClose != null && waitAtReopen != null) ? waitAtClose - waitAtReopen : null;
  await db.collection('closure_events').add(stripUndefined({
    rideId,
    rideName,
    parkId,
    closedAt,
    reopenedAt: new Date().toISOString(),
    durationMin: Math.round(durationMin * 10) / 10,
    waitAtClose: waitAtClose ?? null,
    waitAtReopen: waitAtReopen ?? null,
    delta,
    dayType,
    hourAtReopen,
    dayOfWeek,
  }));
}

async function readAndClearClosure(db, rideId) {
  const ref = db.collection('current_closures').doc(rideId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const data = doc.data();
  await ref.delete();
  return data;
}

async function loadClosureProfiles(db) {
  const snap = await db.collection('closure_profiles').get();
  const map = new Map();
  snap.forEach(doc => map.set(doc.id, doc.data()));
  return map;
}

async function loadArmedDevices(db) {
  const snap = await db.collection('devices')
    .where('notificationsEnabled', '==', true)
    .get();
  const todayPT = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const list = [];
  snap.forEach(doc => {
    const data = doc.data();
    // Skip devices whose trip has ended. Devices without a tripEnd are legacy
    // records — let them through so existing behavior is unchanged.
    if (data.tripEnd && data.tripEnd < todayPT) return;
    // Guarantee deviceId is always present — some older docs were written
    // before the field was added to upsertDevice's create block.
    list.push({ ...data, deviceId: data.deviceId ?? doc.id });
  });
  return list;
}

// Cooldown check via a deterministic doc ID per (deviceId, rideId, type).
// The doc holds the LATEST fire — each new fire overwrites it. This avoids
// the composite index a multi-equality query would otherwise need, and
// reduces cooldown checks to a single `get()`.
function cooldownDocId(deviceId, rideId, type) {
  return `${deviceId}__${rideId}__${type}`;
}

async function isWithinCooldown(db, deviceId, rideId, type) {
  const doc = await db.collection('notification_log').doc(cooldownDocId(deviceId, rideId, type)).get();
  if (!doc.exists) return false;
  const firedAt = doc.data()?.firedAt;
  if (!firedAt) return false;
  return Date.now() - new Date(firedAt).getTime() < 30 * 60_000;
}

async function writeNotificationLog(db, entry) {
  const docId = cooldownDocId(entry.deviceId, entry.rideId, entry.type);
  // Firestore rejects `undefined` anywhere in the document. Strip
  // (rather than convert to null) so absent fields stay absent on
  // overwrite — keeps the schema clean as we add/remove extras.
  await db.collection('notification_log').doc(docId).set(stripUndefined(entry));
}

function stripUndefined(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = stripUndefined(v);
  }
  return out;
}

// Human-friendly duration: "20 min", "an hour", "1.5 hours", "3 hours".
// Used for reopen messages where the scanner has durationMs from the
// matching closure event.

// Build the user-facing notification payload. Copy lives in notification-copy.js.
function buildPayload({ type, rideId, rideName, badge = null, currentWait = null, bucket0Wait = null, rideStats = null, previousWait = null, durationMs = null, waitAtClose = null, isOpportunity = false }) {
  return {
    title: notificationTitle(type, rideName, badge),
    body: notificationBody({ type, badge, currentWait, bucket0Wait, rideStats, durationMs, waitAtClose, isOpportunity }),
    rideId,
    type,
    badge,
  };
}

// Expo push tokens look like ExponentPushToken[...] or ExpoPushToken[...].
// Raw APNs device tokens (hex strings from getDevicePushTokenAsync) are NOT
// supported — they require direct APNs delivery. Configure EAS (eas init)
// to ensure the app always registers Expo-format tokens.
function isExpoToken(token) {
  return typeof token === 'string' &&
    (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['));
}

// Sends via the Expo Push API (https://exp.host/--/api/v2/push/send).
// No auth required for basic delivery. Returns { sent, reason, expired? }.
async function sendExpoPush(device, payload) {
  const { pushToken } = device;
  if (!pushToken) return { sent: false, reason: 'no_expo_token' };
  if (!isExpoToken(pushToken)) {
    // Raw APNs token — can't deliver via Expo Push API. App needs EAS
    // configured so getExpoPushTokenAsync() succeeds and returns an Expo token.
    return { sent: false, reason: 'raw_apns_token_requires_eas' };
  }
  let res;
  try {
    res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        title: payload.title,
        body: payload.body,
        data: { rideId: payload.rideId, type: payload.type, badge: payload.badge },
        sound: 'default',
        ttl: 1800,
      }),
    });
  } catch (err) {
    return { sent: false, reason: err?.message ?? String(err) };
  }
  if (!res.ok) {
    return { sent: false, reason: `expo_http_${res.status}` };
  }
  let json;
  try { json = await res.json(); } catch { return { sent: false, reason: 'bad_response_json' }; }
  const result = json?.data;
  if (result?.status === 'error') {
    const error = result?.details?.error;
    if (error === 'DeviceNotRegistered') {
      return { sent: false, reason: 'device_not_registered', expired: true };
    }
    return { sent: false, reason: error ?? 'expo_error' };
  }
  return { sent: true };
}

// Sends a push to the device. Routes on pushTokenType:
//   'expo' → Expo Push API (APNs via Expo's service)
//   'web'  → VAPID Web Push
// Returns { sent, reason, expired? }. Failures don't throw — the caller
// still writes notification_log so cooldown applies.
async function sendPush(device, payload) {
  if (device.pushTokenType === 'expo') {
    return sendExpoPush(device, payload);
  }
  // Web Push path.
  if (!pushReady) return { sent: false, reason: 'vapid_not_configured' };
  if (!device.pushToken || device.pushTokenType !== 'web') {
    return { sent: false, reason: 'no_web_push_token' };
  }
  let subscription;
  try {
    subscription = JSON.parse(device.pushToken);
  } catch {
    return { sent: false, reason: 'bad_token_json' };
  }
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 1800 });
    return { sent: true };
  } catch (err) {
    const status = err?.statusCode;
    if (status === 404 || status === 410) {
      return { sent: false, reason: 'subscription_expired', expired: true };
    }
    return { sent: false, reason: `${status ?? 'unknown'}: ${err?.message ?? String(err)}` };
  }
}

// When a subscription expires (404/410), null out the device's pushToken
// so future scanner runs don't keep trying to deliver to a dead endpoint.
// The user will see notifications stop and can re-enable from Profile.
async function nullDeviceToken(db, deviceId) {
  await db.collection('devices').doc(deviceId).set(
    { pushToken: null, pushTokenType: null, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

// Shared fire path used by all three notification types. Cooldown check,
// push send, notification_log write, expired-subscription handling, and
// a single log line are all encapsulated here so the main loop stays
// readable.
async function fireNotification({ db, device, currentRide, type, badge = null, extra = {} }) {
  const { deviceId } = device;
  const rideId = currentRide.rideId;

  const onCooldown = await isWithinCooldown(db, deviceId, rideId, type);
  if (onCooldown) {
    log('skipped_cooldown', { deviceId, rideId, type });
    return { fired: false, reason: 'cooldown' };
  }

  const firedAt = new Date().toISOString();
  const payload = buildPayload({
    type,
    rideId,
    rideName: currentRide.name,
    badge,
    currentWait: currentRide.wait,
    // Optional context — main loop injects these per type via `extra`.
    bucket0Wait: extra.bucket0Wait ?? null,
    rideStats: extra.rideStats ?? null,
    previousWait: extra.previousWait ?? null,
    durationMs: extra.durationMs ?? null,
  });
  const result = await sendPush(device, payload);
  await writeNotificationLog(db, {
    deviceId,
    rideId,
    rideName: currentRide.name,
    type,
    badge,
    firedAt,
    expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    currentWait: currentRide.wait,
    // Persist the exact body we sent so the in-app history sheet shows
    // the same phrasing the user got pushed — rather than re-rolling a
    // different random tagline on every render.
    body: payload.body,
    delivered: result.sent,
    deliveryError: result.sent ? null : result.reason,
    ...extra,
  });
  if (result.expired) {
    await nullDeviceToken(db, deviceId);
    log('expired_subscription', { deviceId, rideId });
  }
  log('fired', {
    deviceId,
    rideId,
    rideName: currentRide.name,
    type,
    badge,
    currentWait: currentRide.wait,
    delivered: result.sent,
    deliveryError: result.sent ? undefined : result.reason,
  });
  return { fired: true };
}

// --- park-hours gate ---

// Heuristic copy of the frontend's isParkOpen check (Recommendations.tsx):
// the park is considered open when at least one of its rides has
// status=OPERATING with a non-null wait. Pre-opening artifacts (Disney
// Gallery, walkthroughs) show as OPERATING with null waits — they don't
// count.
function isParkOpen(parkId, snapshot) {
  for (const obs of snapshot.values()) {
    const ride = obs.current;
    if (ride.parkId === parkId && ride.status === 'OPERATING' && ride.wait !== null) {
      return true;
    }
  }
  return false;
}

// --- main ---

async function run() {
  const now = new Date();
  const today = todayInPT(now);
  const dayType = classifyDayType(now);
  const buckets = bucketsAroundNow(now);
  log('scanner_start', { now: now.toISOString(), today, dayType, buckets });

  initWebPush();
  log('vapid_status', { pushReady });

  const db = getFirestore();

  const devices = await loadArmedDevices(db);
  if (devices.length === 0) {
    log('no_enabled_devices');
    return;
  }
  log('enabled_devices', { count: devices.length });

  // Pre-flight park-open check across all DLR parks. If both are closed,
  // skip the heavy reads entirely.
  const snapshot = await readLatestSnapshot(db);
  const openParkIds = DLR_PARK_IDS.filter(id => isParkOpen(id, snapshot));
  if (openParkIds.length === 0) {
    log('all_parks_closed');
    return;
  }
  log('snapshot_loaded', { rides: snapshot.size, openParks: openParkIds.length });

  const [historical, stats, closureProfiles] = await Promise.all([
    loadHistoricalAverages(db),
    loadRideStats(db),
    loadClosureProfiles(db).catch(() => new Map()),
  ]);
  log('lookups_loaded', { historicalKeys: historical.size, statsKeys: stats.size });

  let considered = 0, fired = 0, skippedCooldown = 0, skippedClosed = 0;
  let firedTrough = 0, firedClosure = 0, firedReopen = 0, firedPeak = 0;
  let skippedTypeOptOut = 0;

  // --- First pass: ride-level status-change accounting (Phase E1) ---
  // Closures/reopens are facts about the world, not about any particular
  // device, so we record current_closures/ updates here — once per ride
  // per tick. Device fanout uses the resulting map in the second pass.
  const statusChanges = new Map();
  for (const [rideId, obs] of snapshot) {
    if (!obs.previous) continue;
    if (!openParkIds.includes(obs.current.parkId)) continue;
    const prevOp = obs.previous.status === 'OPERATING';
    const curOp = obs.current.status === 'OPERATING';
    const curDown = obs.current.status === 'DOWN';
    const prevDown = obs.previous.status === 'DOWN';
    if (prevOp && curDown) {
      await recordClosureStart(db, obs.current);
      statusChanges.set(rideId, { kind: 'closure' });
    } else if (prevDown && curOp) {
      const closure = await readAndClearClosure(db, rideId);
      const closedAt = closure?.closedAt ?? null;
      const durationMs = closedAt ? Date.now() - new Date(closedAt).getTime() : null;
      const durationMin = durationMs != null ? durationMs / 60_000 : null;

      // Persist a closure summary so build_closure_profiles.py can read from
      // Firestore instead of a CSV — no manual script re-runs needed.
      if (closedAt && durationMin != null) {
        const ptHour = Number(new Intl.DateTimeFormat('en-US', {
          timeZone: PARK_TZ, hour: 'numeric', hourCycle: 'h23',
        }).format(now));
        const ptDow = new Date(calendarDayUTC(now)).getUTCDay();
        await recordClosureEvent(db, {
          rideId,
          rideName: obs.current.name,
          parkId: obs.current.parkId,
          closedAt,
          durationMin,
          waitAtClose: closure?.waitAtClose ?? null,
          waitAtReopen: obs.current.wait ?? null,
          dayType,
          hourAtReopen: ptHour,
          dayOfWeek: ptDow,
        });
      }

      statusChanges.set(rideId, { kind: 'reopen', closedAt, durationMs, waitAtClose: closure?.waitAtClose ?? null });
    }
  }
  log('status_changes', {
    closures: [...statusChanges.values()].filter(e => e.kind === 'closure').length,
    reopens: [...statusChanges.values()].filter(e => e.kind === 'reopen').length,
  });

  // --- Second pass: device fanout ---
  let skippedWrongPark = 0;
  for (const device of devices) {
    const { mustDoRideIds = [] } = device;
    const dailyParkIds = allowedParkIdsFor(device);
    for (const rideId of mustDoRideIds) {
      const obs = snapshot.get(rideId);
      if (!obs) continue;
      const current = obs.current;
      // Daily-parks gate: skip rides outside the user's selected scope.
      // 'both' (or missing) passes everything (treats user as a hopper).
      if (!dailyParkIds.includes(current.parkId)) {
        skippedWrongPark++;
        continue;
      }
      if (!openParkIds.includes(current.parkId)) {
        skippedClosed++;
        continue;
      }
      considered++;

      // --- Status-change fanout (uses first-pass result) ---
      const change = statusChanges.get(rideId);
      if (change?.kind === 'closure') {
        if (!wantsNotification(device, 'closure')) {
          skippedTypeOptOut++;
        } else {
          const r = await fireNotification({
            db, device, currentRide: current, type: 'closure',
          });
          if (r.fired) { fired++; firedClosure++; }
          else if (r.reason === 'cooldown') skippedCooldown++;
        }
      } else if (change?.kind === 'reopen') {
        if (!wantsNotification(device, 'reopen')) {
          skippedTypeOptOut++;
        } else {
          const rideStats = stats.get(`${current.parkId}__${rideId}__${dayType}`) ?? null;
          const typicalWait = historical.get(`${current.parkId}__${rideId}__${buckets[0]}__${dayType}`)?.wait ?? null;

          // An opportunity reopen: closure was extended AND the current wait
          // is meaningfully below the typical wait for this hour. Uses the same
          // absolute floor as the trough scorer so both signals agree.
          const isOpportunity = (() => {
            if (!change.durationMs || current.wait == null || typicalWait == null) return false;
            const durationMin = change.durationMs / 60_000;
            const profile = closureProfiles.get(rideId);
            const threshold = profile?.shortResetThresholdMin ?? 30;
            if (durationMin <= threshold) return false;
            const drop = typicalWait - current.wait;
            const dropPct = drop / typicalWait;
            return drop >= absoluteFloorForTypical(typicalWait) && dropPct >= 0.30;
          })();

          const r = await fireNotification({
            db, device, currentRide: current, type: 'reopen',
            extra: {
              closedAt: change.closedAt,
              durationMs: change.durationMs,
              waitAtClose: change.waitAtClose,
              rideStats,
              bucket0Wait: typicalWait,
              isOpportunity,
            },
          });
          if (r.fired) { fired++; firedReopen++; }
          else if (r.reason === 'cooldown') skippedCooldown++;
        }
      }

      // --- Trough detection (Phase B) ---
      // Only score rides that are currently operating; closed rides can't
      // have a meaningful trough.
      if (current.status !== 'OPERATING') continue;

      const historicalBuckets = buckets.map((bucket, i) => {
        const v = historical.get(`${current.parkId}__${rideId}__${bucket}__${dayType}`);
        return {
          offsetMinutes: [0, 30, 60, 90, 120, 150][i],
          timeSlot: bucket,
          wait: v?.wait ?? null,
          sampleCount: v?.sampleCount ?? 0,
        };
      });
      const prev = obs.previous;
      const rideForScoring = {
        currentWait: current.wait,
        status: current.status,
        historicalAverage: historicalBuckets[0].wait === null
          ? null
          : { dayType, buckets: historicalBuckets },
        rideStats: stats.get(`${current.parkId}__${rideId}__${dayType}`) ?? null,
        recentHistory: prev
          ? [{ wait: prev.wait, status: prev.status, timestamp: new Date(prev.ts).toISOString(), minutesAgo: Math.round((Date.now() - prev.ts) / 60_000) }]
          : null,
      };

      const badge = scoreRide(rideForScoring);

      // Trough and peak are mutually exclusive: trough fires on a good-score
      // (low relative wait), peak fires when the wait hits p90.
      if (badge === 'star' || badge === 'go') {
        if (!wantsNotification(device, 'trough')) {
          skippedTypeOptOut++;
        } else {
          const r = await fireNotification({
            db, device, currentRide: current, type: 'trough', badge,
            extra: {
              bucket0Wait: historicalBuckets[0]?.wait ?? null,
              rideStats: rideForScoring.rideStats,
            },
          });
          if (r.fired) { fired++; firedTrough++; }
          else if (r.reason === 'cooldown') skippedCooldown++;
        }
      } else {
        const rideStats = rideForScoring.rideStats;
        if (rideStats && rideStats.p90 > 0 && current.wait != null && current.wait >= rideStats.p90) {
          if (!wantsNotification(device, 'peak')) {
            skippedTypeOptOut++;
          } else {
            const r = await fireNotification({
              db, device, currentRide: current, type: 'peak',
              extra: { rideStats },
            });
            if (r.fired) { fired++; firedPeak++; }
            else if (r.reason === 'cooldown') skippedCooldown++;
          }
        }
      }
    }
  }

  log('scanner_done', {
    considered,
    fired,
    firedTrough,
    firedClosure,
    firedReopen,
    firedPeak,
    skippedCooldown,
    skippedClosed,
    skippedWrongPark,
    skippedTypeOptOut,
  });
}

run().catch(err => {
  console.error(JSON.stringify({ event: 'scanner_error', error: String(err), stack: err?.stack }));
  process.exit(1);
});
