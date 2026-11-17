// Capture a live park snapshot as a harness fixture, so the prompt can be scored on real data.
//
//   FIREBASE_SERVICE_ACCOUNT_JSON="$(cat ../firebase-key.json)" NODE_EXTRA_CA_CERTS=$HOME/.zscaler-ca.pem \
//   npm run live -- --park disneyland [--lat 33.8121 --lng -117.9190]
//
// Writes evals/live/LIVE-<park>-<stamp>.json and prints the id. Then:
//   npm run eval -- --fixtures LIVE-... --variant spec-codes --runs 3
//
// The snapshot is the same data the Lambda would use (fetchPark, metadata, hours, reopens,
// weather) reduced to the RideFact shape the harness derives fixtures from. It has no
// scripted assertions; the hard code checks and the AI judge are the test.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchPark } from '../../app/backend/src/handler';
import { findNearestRide } from '../../app/backend/src/recommendations/handler';
import { ensureRideMetadataLoaded, lookupRideMetadata } from '../../app/backend/src/recommendations/rideMetadata';
import { walkingMinutes } from '../../app/backend/src/recommendations/walkingDistance';
import { getParkHours } from '../../app/backend/src/recommendations/parkHours';
import { loadRecentReopens } from '../../app/backend/src/recentReopens';
import { loadWeatherLine } from '../../app/backend/src/weather';
import { formatLocalTime, parkTimeZone } from '../../app/backend/src/recommendations/buildPromptInputs';
import { ParkSlug } from '../../app/backend/src/types';
import { arg, EVALS_ROOT, stamp } from './args';
import { Fixture, RideFact } from './types';

const HUBS: Record<ParkSlug, { lat: number; lng: number }> = {
  'disneyland': { lat: 33.8121, lng: -117.9190 },
  'california-adventure': { lat: 33.8062, lng: -117.9209 },
};

function minutesOfDay(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(d);
  const h = Number(parts.find(p => p.type === 'hour')!.value) % 24;
  const m = Number(parts.find(p => p.type === 'minute')!.value);
  return h * 60 + m;
}

async function main() {
  const park = (arg('park', 'disneyland') as ParkSlug);
  if (!HUBS[park]) throw new Error(`--park must be one of ${Object.keys(HUBS).join(', ')}`);
  const lat = Number(arg('lat', String(HUBS[park].lat)));
  const lng = Number(arg('lng', String(HUBS[park].lng)));
  const now = new Date();
  const tz = parkTimeZone(park);

  const [data, metadataMap, hours, reopens, weatherLine] = await Promise.all([
    fetchPark(park, undefined, null, null, true),
    ensureRideMetadataLoaded(),
    getParkHours(park, now).catch(() => null),
    loadRecentReopens(now).catch(() => new Map<string, number>()),
    loadWeatherLine(park, now).catch(() => null),
  ]);

  const nearest = findNearestRide(lat, lng, metadataMap, data.rides);
  const facts: RideFact[] = [];
  let anchor: RideFact | null = null;
  for (const ride of data.rides) {
    if (ride.status !== 'OPERATING' || ride.currentWait == null) continue;
    const meta = lookupRideMetadata(metadataMap, ride.id);
    if (!meta) continue; // the harness looks static facts up by metadata name
    const r = ride.verdict?.reasons;
    const buckets = (ride.historicalAverage?.buckets ?? []).map(b => b.wait ?? ride.currentWait!);
    const fact: RideFact = {
      name: meta.name,
      wait: ride.currentWait,
      usual: r?.typical == null ? null : Math.round(r.typical),
      verdict: ride.verdict?.verdict ?? 'neutral',
      reason: (r?.primary as RideFact['reason']) ?? 'none',
      walk: walkingMinutes({ lat, lng }, meta, meta.walkPenaltyMinutes ?? 0) ?? 0,
      buckets: buckets.length === 6 ? buckets : Array(6).fill(ride.currentWait),
      window: r?.betterWindowWait != null && r.betterWindowInMin != null && r.beatableSoon
        ? { wait: Math.round(r.betterWindowWait), inMin: r.betterWindowInMin } : undefined,
      p10: ride.rideStats?.p10, p90: ride.rideStats?.p90,
      minutesSinceReopen: reopens.get(ride.id) ?? null,
      wanted: false,
    };
    if (nearest && ride.id === nearest.id) anchor = fact; else facts.push(fact);
  }
  // The GPS-nearest ride may be closed or have no posted wait (the Lambda anchors on it
  // anyway for the header). For the fixture, fall back to the nearest operating ride.
  if (!anchor) {
    facts.sort((a, b) => a.walk - b.walk);
    anchor = facts.shift() ?? null;
  }
  if (!anchor) throw new Error('No operating rides to anchor on');

  const wm = weatherLine ? /^(-?\d+)F, feels like (-?\d+), (.+)$/.exec(weatherLine) : null;
  const id = `LIVE-${park}-${stamp()}`;
  const localTime = formatLocalTime(now, tz);
  const fixture: Omit<Fixture, 'asserts'> = {
    id,
    title: `Live snapshot: ${park} at ${localTime}`,
    tests: 'Real park data, no scripted expectation. Hard code checks and the AI judge decide.',
    park, localTime, nowMin: minutesOfDay(now, tz),
    hours: hours ? { open: hours.open, close: hours.close } : null,
    persona: null,
    anchor, rides: facts,
    weather: wm ? { tempF: Number(wm[1]), feelsF: Number(wm[2]), conditions: wm[3] } : undefined,
    filled: ['Live snapshot: every value came from the backend at capture time; persona is the default guest with no wanted rides.'],
    expectation: 'No scripted answer. Judge whether every pick is a sensible move to walk to right now given the waits, usual waits, forecast trend and walk; whether captions are grounded in the data and present-tense; and whether any skip-verdict pick is framed honestly as a busy-day or least-bad choice.',
    ideal: [], bad: [],
  };
  mkdirSync(join(EVALS_ROOT, 'live'), { recursive: true });
  const file = join(EVALS_ROOT, 'live', `${id}.json`);
  writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`${id}\n${file}\n${facts.length + 1} operating rides, anchor ${anchor.name}, ${localTime}, closes ${hours?.close ?? 'unknown'}${weatherLine ? `, ${weatherLine}` : ''}`);
}

main().catch(e => { console.error(e); process.exit(1); });
