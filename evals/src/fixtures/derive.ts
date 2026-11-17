// Turns a fixture's raw facts into the derived fields the spec defines (section 6), using real ride
// metadata from ride_metadata.json. This is the harness's OWN implementation, used to check answers;
// it deliberately does not import the backend's version, so a bug there cannot hide a failure here.

import { readFileSync } from 'fs';
import { join } from 'path';
import { EVALS_ROOT } from '../args';
import { BuiltFixture, DerivedRide, Fixture, RideFact } from '../types';

interface Meta { name: string; themeparks_id: string; land: string; height_min_in: number | null; thrill_level: number | null; pregnancy_advisory: boolean; transfer_required: boolean }

let metaCache: Map<string, Meta> | null = null;
export function rideMeta(name: string): Meta {
  if (!metaCache) {
    const raw = JSON.parse(readFileSync(join(EVALS_ROOT, '..', 'ride_metadata.json'), 'utf8'));
    const list: Meta[] = Array.isArray(raw) ? raw : Object.values(raw);
    metaCache = new Map();
    for (const m of list) if (!metaCache.has(m.name)) metaCache.set(m.name, m);
  }
  const m = metaCache.get(name);
  if (!m) throw new Error(`Ride "${name}" is not in ride_metadata.json (fixture names must match exactly)`);
  return m;
}

// Same table as app/frontend/src/personaSort.ts, so the list sort and the AI never disagree (spec 6.4).
const TYPICAL_HEIGHT_IN: Record<number, number> = { 0: 24, 1: 30, 2: 34, 3: 37, 4: 40, 5: 43, 6: 45, 7: 48, 8: 50, 9: 52, 10: 54, 11: 56, 12: 58 };
export function typicalHeightInches(age: number): number {
  if (age >= 13) return 72;
  if (age <= 0) return TYPICAL_HEIGHT_IN[0];
  return TYPICAL_HEIGHT_IN[age] ?? 72;
}

const clockToMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function ofUsual(wait: number, usual: number | null): DerivedRide['ofUsual'] {
  if (usual == null || usual <= 0) return null;
  const r = wait / usual;
  return r < 0.6 ? 'far-below' : r < 0.85 ? 'below' : r <= 1.15 ? 'about' : r <= 1.5 ? 'above' : 'far-above';
}

export function buildFixture(fx: Fixture): BuiltFixture {
  const minutesUntilClose = fx.hours ? clockToMin(fx.hours.close) - fx.nowMin : null;
  const persona = fx.persona;
  const derive = (r: RideFact, isAnchor: boolean): DerivedRide => {
    const m = rideMeta(r.name);
    const restrictedFor: string[] = [];
    if (persona?.youngestAge != null && m.height_min_in != null && typicalHeightInches(persona.youngestAge) < m.height_min_in) {
      restrictedFor.push(persona.youngestAge <= 3 ? 'toddler' : 'child');
    }
    const needs = persona?.accessibilityNeeds ?? [];
    const intense = m.thrill_level != null && m.thrill_level >= 4;
    if (needs.includes('pregnant') && (m.pregnancy_advisory || intense)) restrictedFor.push('pregnancy');
    if (needs.includes('wheelchair') && m.transfer_required) restrictedFor.push('wheelchair');
    if (needs.includes('sensory') && intense) restrictedFor.push('sensory');
    const wanted = r.wanted ?? (persona?.mustDoRideIds ?? []).includes(m.themeparks_id);
    return {
      ...r,
      wanted,
      id: m.themeparks_id,
      land: m.land,
      heightMinIn: m.height_min_in,
      thrillLevel: m.thrill_level,
      pregnancyAdvisory: !!m.pregnancy_advisory,
      transferRequired: !!m.transfer_required,
      isAnchor,
      vsUsual: r.usual == null ? null : r.wait - r.usual,
      ofUsual: ofUsual(r.wait, r.usual),
      restrictedFor,
      reachableBeforeClose: minutesUntilClose == null ? true : r.walk < minutesUntilClose,
      buckets: r.buckets ?? Array(6).fill(r.wait),
    };
  };
  const rides = [derive(fx.anchor, true), ...fx.rides.map(r => derive(r, false))]
    .sort((a, b) => a.walk - b.walk || a.name.localeCompare(b.name));

  // Field shape over the candidate pool (spec 6.5).
  const pool = rides.filter(r => r.reachableBeforeClose);
  const labels = pool.map(r => r.ofUsual);
  const vs = pool.map(r => r.vsUsual).filter((x): x is number => x != null);
  const anyBelow = labels.some(l => l === 'below' || l === 'far-below');
  const aboveCount = labels.filter(l => l === 'above' || l === 'far-above').length;
  const field: BuiltFixture['field'] =
    !anyBelow && aboveCount >= pool.length / 2 ? 'bad'
    : labels.every(l => l === 'about' || l === 'below') && vs.length > 0 && Math.max(...vs) - Math.min(...vs) < 15 ? 'flat'
    : 'mixed';

  const wantedIds = rides.filter(r => r.wanted).map(r => r.id);
  const effectivePersona = fx.persona || wantedIds.length
    ? { ...(fx.persona ?? { tripDuration: null, youngestAge: null, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [] }), mustDoRideIds: [...new Set([...(fx.persona?.mustDoRideIds ?? []), ...wantedIds])] }
    : null;
  return { fx, rides, byName: new Map(rides.map(r => [r.name, r])), field, minutesUntilClose, persona: effectivePersona };
}
