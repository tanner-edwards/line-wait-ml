import { CombinedResponse, ParkData, ParkError, Ride, isParkError } from './types';

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
 * - Anything else: "Closed"
 */
export function rideWaitLabel(ride: Ride): string {
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

export type SortBy = 'opportunity' | 'badge' | 'wait' | 'demand' | 'distance';

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

/**
 * Flattens the response into a park-grouped, land-free sorted list.
 * Park headers are preserved; land headers are omitted.
 * `origin` is required only for 'distance' sort — pass null otherwise.
 */
export function flattenSorted(
  response: CombinedResponse,
  sortBy: SortBy,
  origin: { lat: number; lng: number } | null
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
      if (sortBy === 'opportunity') {
        // Operating before closed.
        const aOpen = a.status === 'OPERATING';
        const bOpen = b.status === 'OPERATING';
        if (aOpen !== bOpen) return aOpen ? -1 : 1;
        // Primary: badge rank.
        const diff = badgeRank(a.score?.badge) - badgeRank(b.score?.badge);
        if (diff !== 0) return diff;
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
      if (sortBy === 'badge') {
        const diff = badgeRank(a.score?.badge) - badgeRank(b.score?.badge);
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
