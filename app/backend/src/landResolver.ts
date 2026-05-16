import { getLandMap } from './landMapping';
import { ParkSlug } from './types';

/**
 * Returns the human-readable land name for a given ride id within a park.
 * Falls back to 'Other' when the id isn't in the static mapping — covers
 * newly opened attractions we haven't curated yet.
 */
export function resolveLand(rideId: string, parkSlug: ParkSlug): string {
  return getLandMap(parkSlug)[rideId] ?? 'Other';
}
