// Filter the combined park response by the daily-park scope.
// Used by Home (to filter the live wait list) and by Recommendations (to
// scope the ride picker). When scope is 'both', the data is returned
// unchanged.

import { CombinedResponse, DailyParks, ParkSlug } from '../types';

const PARK_DISPLAY_NAME: Record<Exclude<DailyParks, 'both'>, string> = {
  'disneyland': 'Disneyland',
  'california-adventure': 'Disney California Adventure',
};

export function parkDisplayNameFor(scope: Exclude<DailyParks, 'both'>): string {
  return PARK_DISPLAY_NAME[scope];
}

export function filterByDailyParks(
  data: CombinedResponse,
  scope: DailyParks
): CombinedResponse {
  if (scope === 'both') return data;
  const target = PARK_DISPLAY_NAME[scope];
  return {
    ...data,
    parks: data.parks.filter(p => p.park === target),
  };
}

/** Given a rideId and the parks-by-slug map, returns which park the ride
 *  belongs to, or null if not found. Useful when the user picked a ride in
 *  "both" mode and we need to derive the park to send to /v2/recommendations. */
export function parkOfRide(
  rideId: string,
  ridesByPark: Record<ParkSlug, { id: string }[]>
): ParkSlug | null {
  for (const slug of Object.keys(ridesByPark) as ParkSlug[]) {
    if (ridesByPark[slug].some(r => r.id === rideId)) return slug;
  }
  return null;
}
