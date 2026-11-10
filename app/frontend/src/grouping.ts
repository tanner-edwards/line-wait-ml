import { CombinedResponse, ParkData, ParkError, Persona, Ride, isParkError } from './types';
import { personaScore } from './personaSort';

export type ListItem =
  | { kind: 'park-header'; key: string; park: string; errored: boolean }
  | { kind: 'land-header'; key: string; land: string }
  | { kind: 'ride'; key: string; ride: Ride };

/**
 * Flattens the combined response into a single list of items ready for FlatList.
 * Park order is preserved (Disneyland first, then DCA). Within each park, lands
 * are sorted alphabetically. Within each land, operating rides come first sorted
 * alphabetically, then closed/down rides sorted alphabetically.
 *
 * Errored parks render their header (with errored: true) and no rides — the
 * screen renders the error banner separately.
 */
export function flattenForList(response: CombinedResponse): ListItem[] {
  const items: ListItem[] = [];

  for (const entry of response.parks) {
    items.push({
      kind: 'park-header',
      key: `park:${entry.park}`,
      park: entry.park,
      errored: isParkError(entry),
    });

    if (isParkError(entry)) continue;

    const ridesByLand = groupRidesByLand(entry.rides);
    const sortedLands = Object.keys(ridesByLand).sort((a, b) => a.localeCompare(b));

    for (const land of sortedLands) {
      items.push({
        kind: 'land-header',
        key: `land:${entry.park}:${land}`,
        land,
      });

      for (const ride of sortRidesWithinLand(ridesByLand[land])) {
        items.push({
          kind: 'ride',
          key: `ride:${entry.park}:${ride.id}`,
          ride,
        });
      }
    }
  }

  return items;
}

function groupRidesByLand(rides: Ride[]): Record<string, Ride[]> {
  const grouped: Record<string, Ride[]> = {};
  for (const ride of rides) {
    if (!grouped[ride.land]) grouped[ride.land] = [];
    grouped[ride.land].push(ride);
  }
  return grouped;
}

function sortRidesWithinLand(rides: Ride[]): Ride[] {
  return [...rides].sort((a, b) => {
    const aOpen = a.status === 'OPERATING';
    const bOpen = b.status === 'OPERATING';
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Returns the human-readable wait label for a ride.
 * - Operating rides with a wait number: "<n> min"
 * - Operating rides without a wait number: "—"
 * - Rides in scheduled refurbishment: "Refurbishment"
 * - Anything else closed: "Closed"
 */
export function rideWaitLabel(ride: Ride): string {
  if (ride.status === 'REFURBISHMENT') return 'Refurbishment';
  if (ride.status !== 'OPERATING') return 'Closed';
  if (ride.currentWait == null) return '—';
  return `${ride.currentWait} min`;
}

export function erroredParks(response: CombinedResponse): ParkError[] {
  return response.parks.filter(isParkError);
}

export function successfulParks(response: CombinedResponse): ParkData[] {
  return response.parks.filter((p): p is ParkData => !isParkError(p));
}

// --- Sort support ---

// 'nearby' is the Discover chip, not a SortMenu option: walk time first,
// opportunity within the same walk minute.
export type SortBy = 'opportunity' | 'badge' | 'wait' | 'demand' | 'distance' | 'nearby';

const BADGE_RANK: Record<string, number> = { star: 0, go: 1, skip: 3 };
function badgeRank(badge: string | null | undefined): number {
  return badge != null ? (BADGE_RANK[badge] ?? 2) : 2;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const WALK_SPEED_MPM = 83;
function walkPathMultiplier(m: number) {
  return m >= 640 ? 2.0 : m >= 366 ? 1.6 : 1.3;
}
/** Estimated walk minutes (path-adjusted), or null when the ride has no coords. */
export function walkMinsTo(
  origin: { lat: number; lng: number },
  ride: { lat: number | null; lng: number | null }
): number | null {
  if (ride.lat == null || ride.lng == null) return null;
  const raw = haversineMeters(origin.lat, origin.lng, ride.lat, ride.lng);
  return Math.max(1, Math.round((raw * walkPathMultiplier(raw)) / WALK_SPEED_MPM));
}

function compareOpportunity(
  a: Ride,
  b: Ride,
  origin: { lat: number; lng: number } | null,
  persona: Persona | null
): number {
  // Operating before closed.
  const aOpen = a.status === 'OPERATING';
  const bOpen = b.status === 'OPERATING';
  if (aOpen !== bOpen) return aOpen ? -1 : 1;
  // Primary: badge rank.
  const diff = badgeRank(a.verdict?.verdict) - badgeRank(b.verdict?.verdict);
  if (diff !== 0) return diff;
  // Persona: personalize within the opportunity tier (higher score first).
  // No-op for a null/empty persona, preserving the non-personalized order.
  const ps = personaScore(b, persona) - personaScore(a, persona);
  if (ps !== 0) return ps;
  // Secondary: distance (if we have a fix) or land name.
  if (origin) {
    const aDist = a.lat != null && a.lng != null ? haversineMeters(origin.lat, origin.lng, a.lat, a.lng) : Infinity;
    const bDist = b.lat != null && b.lng != null ? haversineMeters(origin.lat, origin.lng, b.lat, b.lng) : Infinity;
    if (aDist !== bDist) return aDist - bDist;
  } else {
    const landDiff = a.land.localeCompare(b.land);
    if (landDiff !== 0) return landDiff;
  }
  return a.name.localeCompare(b.name);
}

/**
 * Flattens the response into a park-grouped, land-free sorted list.
 * Park headers are preserved; land headers are omitted.
 * `origin` is required only for 'distance' sort — pass null otherwise.
 */
export function flattenSorted(
  response: CombinedResponse,
  sortBy: SortBy,
  origin: { lat: number; lng: number } | null,
  persona: Persona | null = null
): ListItem[] {
  const items: ListItem[] = [];

  for (const entry of response.parks) {
    items.push({
      kind: 'park-header',
      key: `park:${entry.park}`,
      park: entry.park,
      errored: isParkError(entry),
    });

    if (isParkError(entry)) continue;

    const sorted = [...entry.rides].sort((a, b) => {
      if (sortBy === 'opportunity') return compareOpportunity(a, b, origin, persona);
      if (sortBy === 'nearby' && origin) {
        // Bucket by the walk minutes the row displays — raw meters almost
        // never tie, so opportunity would otherwise never get a say.
        const aWalk = walkMinsTo(origin, a) ?? Infinity;
        const bWalk = walkMinsTo(origin, b) ?? Infinity;
        if (aWalk !== bWalk) return aWalk - bWalk;
        return compareOpportunity(a, b, origin, persona);
      }
      if (sortBy === 'badge') {
        const diff = badgeRank(a.verdict?.verdict) - badgeRank(b.verdict?.verdict);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      }
      if (sortBy === 'wait') {
        const aW = a.currentWait ?? Infinity;
        const bW = b.currentWait ?? Infinity;
        return aW !== bW ? aW - bW : a.name.localeCompare(b.name);
      }
      if (sortBy === 'demand') {
        const aP = a.rideStats?.p90 ?? -1;
        const bP = b.rideStats?.p90 ?? -1;
        return aP !== bP ? bP - aP : a.name.localeCompare(b.name);
      }
      if (sortBy === 'distance' && origin) {
        const aDist =
          a.lat != null && a.lng != null
            ? haversineMeters(origin.lat, origin.lng, a.lat, a.lng)
            : Infinity;
        const bDist =
          b.lat != null && b.lng != null
            ? haversineMeters(origin.lat, origin.lng, b.lat, b.lng)
            : Infinity;
        return aDist !== bDist ? aDist - bDist : a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });

    for (const ride of sorted) {
      items.push({ kind: 'ride', key: `ride:${entry.park}:${ride.id}`, ride });
    }
  }

  return items;
}

/** Discover's Nearby chip: rides within this walk... */
export const NEARBY_MAX_WALK_MINS = 5;
/** ...but never fewer than this many (edge of park, outside the park). */
export const NEARBY_MIN_RIDES = 5;

/**
 * Ride ids Nearby keeps: everything within NEARBY_MAX_WALK_MINS, topped up to
 * the NEARBY_MIN_RIDES closest when too few qualify. Uses the same walk-minute
 * value the rows display. Rides without coords sort last.
 */
export function nearbyRideIds(rides: Ride[], origin: { lat: number; lng: number }): Set<string> {
  const byWalk = rides
    .map(r => ({ id: r.id, walk: walkMinsTo(origin, r) ?? Infinity }))
    .sort((a, b) => a.walk - b.walk);
  const within = byWalk.filter(r => r.walk <= NEARBY_MAX_WALK_MINS);
  const kept = within.length >= NEARBY_MIN_RIDES ? within : byWalk.slice(0, NEARBY_MIN_RIDES);
  return new Set(kept.map(r => r.id));
}

/**
 * Filters a flattened list down to rides matching the query by name.
 * Park/land headers are dropped entirely rather than kept-if-non-empty —
 * search results read as a flat list, same as the onboarding ride search.
 * Empty/whitespace query returns `items` unchanged.
 */
export function filterItemsByQuery(items: ListItem[], query: string): ListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(item => item.kind === 'ride' && item.ride.name.toLowerCase().includes(q));
}
