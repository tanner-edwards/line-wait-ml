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
//
// `npm run eval -- --live disneyland` uses captureLive + sampleLive instead: one capture,
// a random subset of rides, one fixture per persona preset (src/personas.ts), all written
// under evals/live/ so the run is reproducible and re-judgeable.
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
import { rideMeta } from './fixtures/derive';
import { PersonaPreset } from './personas';
import { Fixture, RideFact } from './types';

export const HUBS: Record<ParkSlug, { lat: number; lng: number }> = {
  'disneyland': { lat: 33.8121, lng: -117.9190 },
  'california-adventure': { lat: 33.8062, lng: -117.9209 },
};

/**
 * Starting-spot playbook (Tanner, 2026-11-21): fixed places the guest stands, so live runs
 * are a benchmark that can be compared across days, not just one hub. `hub` is the park's
 * central hub; every other spot is a ride, and the guest stands at its coordinates (so it is
 * the anchor when it is operating). Keys carry no hyphens: they go into fixture ids.
 */
export const START_SPOTS: Record<ParkSlug, Record<string, string | null>> = {
  'disneyland': {
    hub: null,
    fantasyland: 'King Arthur Carrousel',
    tomorrowland: 'Space Mountain',
    neworleans: 'Pirates of the Caribbean',
    frontierland: 'Big Thunder Mountain Railroad',
    galaxysedge: 'Star Wars: Rise of the Resistance',
  },
  'california-adventure': {
    hub: null,
    pixarpier: 'Toy Story Midway Mania!',
    carsland: 'Radiator Springs Racers',
    avengers: 'WEB SLINGERS: A Spider-Man Adventure',
    grizzlypeak: "Soarin' Around the World",
  },
};

/** Coordinates and a label for a playbook spot. */
export function startSpot(park: ParkSlug, key: string): { lat: number; lng: number; label: string } {
  const spots = START_SPOTS[park];
  if (!spots || !(key in spots)) throw new Error(`--start must be one of ${Object.keys(spots ?? {}).join(', ')} for ${park}`);
  const ride = spots[key];
  if (!ride) return { ...HUBS[park], label: 'the central hub' };
  const m = rideMeta(ride);
  return { lat: m.lat, lng: m.lng, label: `${ride} (${m.land})` };
}

function minutesOfDay(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(d);
  const h = Number(parts.find(p => p.type === 'hour')!.value) % 24;
  const m = Number(parts.find(p => p.type === 'minute')!.value);
  return h * 60 + m;
}

/** A capture before it gets an id, title, and persona. */
export type LiveBase = Omit<Fixture, 'asserts' | 'id' | 'title' | 'persona'> & { stamp: string; start?: string };

/** Everything the Lambda would see for this park right now, reduced to RideFacts. */
export async function captureLive(park: ParkSlug, lat = HUBS[park].lat, lng = HUBS[park].lng): Promise<LiveBase> {
  if (!HUBS[park]) throw new Error(`park must be one of ${Object.keys(HUBS).join(', ')}`);
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
  return {
    stamp: stamp(),
    tests: 'Real park data, no scripted expectation. Hard code checks and the AI judge decide.',
    park, localTime: formatLocalTime(now, tz), nowMin: minutesOfDay(now, tz),
    hours: hours ? { open: hours.open, close: hours.close } : null,
    anchor, rides: facts,
    weather: wm ? { tempF: Number(wm[1]), feelsF: Number(wm[2]), conditions: wm[3] } : undefined,
    filled: ['Live snapshot: every value came from the backend at capture time.'],
    expectation: 'No scripted answer. Judge whether every pick is a sensible move to walk to right now given the waits, usual waits, forecast trend and walk; whether captions are grounded in the data and present-tense; and whether any skip-verdict pick is framed honestly as a busy-day or least-bad choice.',
    ideal: [], bad: [],
  };
}

export function writeLiveFixture(fx: Omit<Fixture, 'asserts'>): string {
  mkdirSync(join(EVALS_ROOT, 'live'), { recursive: true });
  const file = join(EVALS_ROOT, 'live', `${fx.id}.json`);
  writeFileSync(file, JSON.stringify(fx, null, 2) + '\n');
  return file;
}

/** Small seeded RNG (mulberry32) so a sample can be reproduced from its printed seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], next: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * One random ride set, one fixture per persona preset. The anchor is always in. The wanted
 * list is drawn once from the sample; preset k takes its first `wanted` entries, so every
 * preset that wants rides wants the same ones. Returns the fixtures and the ids written.
 */
export function sampleLive(base: LiveBase, opts: { rides: number; seed: number; presets: PersonaPreset[] }): Omit<Fixture, 'asserts'>[] {
  const next = rng(opts.seed);
  const n = Math.min(opts.rides, base.rides.length);
  const picked = shuffle(base.rides, next).slice(0, n);
  const wantedPool = shuffle(picked, next).map(r => r.name);
  const sampleNote = `Random sample: ${n} of ${base.rides.length} operating rides plus the anchor, seed ${opts.seed}.`;
  return opts.presets.map(p => {
    const wanted = new Set(wantedPool.slice(0, p.wanted));
    const rides = picked.map(r => ({ ...r, wanted: wanted.has(r.name) }));
    return {
      ...base,
      id: `LIVE-${base.park}-${base.stamp}${base.start ? `-${base.start}` : ''}-${p.key}`,
      title: `Live ${base.park} at ${base.localTime}${base.start ? `, from ${base.start}` : ''}, ${p.label}`,
      persona: p.persona,
      anchor: { ...base.anchor, wanted: false },
      rides,
      filled: [...base.filled, sampleNote, `Persona preset "${p.key}": ${p.label}.`, wanted.size ? `Wanted: ${[...wanted].join(', ')}.` : 'No wanted rides.'],
    };
  }).map(({ stamp: _s, start: _st, ...fx }) => fx);
}

async function main() {
  const park = (arg('park', 'disneyland') as ParkSlug);
  if (!HUBS[park]) throw new Error(`--park must be one of ${Object.keys(HUBS).join(', ')}`);
  const spot = startSpot(park, arg('start', 'hub')!);
  const lat = Number(arg('lat', String(spot.lat)));
  const lng = Number(arg('lng', String(spot.lng)));
  const { stamp: st, ...base } = await captureLive(park, lat, lng);
  const id = `LIVE-${park}-${st}`;
  const fixture: Omit<Fixture, 'asserts'> = {
    ...base, id,
    title: `Live snapshot: ${park} at ${base.localTime}`,
    persona: null,
    filled: [...base.filled, 'Persona is the default guest with no wanted rides.'],
  };
  const file = writeLiveFixture(fixture);
  const w = base.weather ? `, ${base.weather.tempF}F, feels like ${base.weather.feelsF}, ${base.weather.conditions}` : '';
  console.log(`${id}\n${file}\n${base.rides.length + 1} operating rides, anchor ${base.anchor.name}, ${base.localTime}, closes ${base.hours?.close ?? 'unknown'}${w}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
