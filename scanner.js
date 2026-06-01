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

const PARK_TZ = 'America/Los_Angeles';

// Disneyland Resort park UUIDs (match collect.js + backend/src/types.ts).
// historical_averages and ride_stats docs are keyed by these IDs.
const DLR_PARK_IDS = [
  '7340550b-c14d-4def-80bb-acdb51d49a66', // Disneyland Park
  '832fcd51-ea19-4e77-85c7-75d5843b127c', // Disney California Adventure
];

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
  return [at(0), at(30), at(60), at(90), at(120)];
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
  if (b0.sampleCount < 1) return null;

  // Factor 1: current vs t+0 bucket average (±2)
  let vsAvgDelta = null, f1 = 0;
  if (b0.wait !== null && b0.wait !== 0) {
    vsAvgDelta = (currentWait - b0.wait) / b0.wait;
    if (Math.abs(currentWait - b0.wait) >= 5) {
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

  const isGoldStar =
    rideStats &&
    rideStats.p50 >= 25 &&
    currentWait <= rideStats.p10 * 1.15 &&
    vsAvgDelta !== null && vsAvgDelta < -0.30 &&
    projDelta !== null && projDelta > 0.10;

  if (isGoldStar) return 'star';
  if (score >= 2) return (projDelta !== null && projDelta < -0.30) ? null : 'go';
  if (score <= -2) return 'skip';
  return null;
}

// --- firestore reads ---

// Reads the most-recent wait_times tick. collect.js writes a batch every
// ~10 min, so the past 15 minutes catches the latest snapshot plus a buffer.
// Returns Map<rideId, { ts, parkId, rideId, name, status, wait }>.
async function readLatestSnapshot(db) {
  const since = new Date(Date.now() - 15 * 60_000);
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
    const existing = byRide.get(d.ride_id);
    if (!existing || ts > existing.ts) {
      byRide.set(d.ride_id, {
        ts,
        parkId: d.park_id,
        rideId: d.ride_id,
        name: d.ride_name,
        status: d.status,
        wait: d.wait_minutes,
      });
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
    map.set(`${d.parkId}__${d.rideId}__${d.dayType}`, {
      p10: d.p10, p50: d.p50, p90: d.p90, sampleCount: d.sampleCount,
    });
  });
  return map;
}

async function loadArmedDevices(db, today) {
  const snap = await db.collection('devices')
    .where('notificationsEnabled', '==', true)
    .where('armedDate', '==', today)
    .get();
  const list = [];
  snap.forEach(doc => list.push(doc.data()));
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
  await db.collection('notification_log').doc(docId).set(entry);
}

// --- park-hours gate ---

// Heuristic copy of the frontend's isParkOpen check (Recommendations.tsx):
// the park is considered open when at least one of its rides has
// status=OPERATING with a non-null wait. Pre-opening artifacts (Disney
// Gallery, walkthroughs) show as OPERATING with null waits — they don't
// count.
function isParkOpen(parkId, snapshot) {
  for (const ride of snapshot.values()) {
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

  const db = getFirestore();

  // Bail early if no devices are armed — saves Firestore reads.
  const devices = await loadArmedDevices(db, today);
  if (devices.length === 0) {
    log('no_armed_devices', { today });
    return;
  }
  log('armed_devices', { count: devices.length });

  // Pre-flight park-open check across all DLR parks. If both are closed,
  // skip the heavy reads entirely.
  const snapshot = await readLatestSnapshot(db);
  const openParkIds = DLR_PARK_IDS.filter(id => isParkOpen(id, snapshot));
  if (openParkIds.length === 0) {
    log('all_parks_closed');
    return;
  }
  log('snapshot_loaded', { rides: snapshot.size, openParks: openParkIds.length });

  const [historical, stats] = await Promise.all([
    loadHistoricalAverages(db),
    loadRideStats(db),
  ]);
  log('lookups_loaded', { historicalKeys: historical.size, statsKeys: stats.size });

  let considered = 0, fired = 0, skippedCooldown = 0, skippedClosed = 0;

  for (const device of devices) {
    const { deviceId, mustDoRideIds = [] } = device;
    for (const rideId of mustDoRideIds) {
      const ride = snapshot.get(rideId);
      if (!ride) continue;
      if (!openParkIds.includes(ride.parkId)) {
        skippedClosed++;
        continue;
      }

      const historicalBuckets = buckets.map((bucket, i) => {
        const v = historical.get(`${ride.parkId}__${rideId}__${bucket}__${dayType}`);
        return {
          offsetMinutes: [0, 30, 60, 90, 120][i],
          timeSlot: bucket,
          wait: v?.wait ?? null,
          sampleCount: v?.sampleCount ?? 0,
        };
      });
      const rideForScoring = {
        currentWait: ride.wait,
        status: ride.status,
        historicalAverage: historicalBuckets[0].wait === null
          ? null
          : { dayType, buckets: historicalBuckets },
        rideStats: stats.get(`${ride.parkId}__${rideId}__${dayType}`) ?? null,
      };

      considered++;
      const badge = scoreRide(rideForScoring);
      if (badge !== 'star' && badge !== 'go') continue;

      const onCooldown = await isWithinCooldown(db, deviceId, rideId, 'trough');
      if (onCooldown) {
        log('skipped_cooldown', { deviceId, rideId, badge });
        skippedCooldown++;
        continue;
      }

      const firedAt = new Date().toISOString();
      await writeNotificationLog(db, {
        deviceId,
        rideId,
        rideName: ride.name,
        type: 'trough',
        badge,
        firedAt,
        expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
        currentWait: ride.wait,
        // delivered=false marks the dry-run phase — Phase B2 sets this true
        // after a successful push send.
        delivered: false,
      });
      log('fired', {
        deviceId,
        rideId,
        rideName: ride.name,
        badge,
        currentWait: ride.wait,
      });
      fired++;
    }
  }

  log('scanner_done', { considered, fired, skippedCooldown, skippedClosed });
}

run().catch(err => {
  console.error(JSON.stringify({ event: 'scanner_error', error: String(err), stack: err?.stack }));
  process.exit(1);
});
