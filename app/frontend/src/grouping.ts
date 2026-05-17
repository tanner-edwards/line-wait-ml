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
