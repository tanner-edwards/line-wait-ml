// Walking-distance estimate between two ride locations inside a Disney park.
//
// Approach: haversine straight-line distance × 1.3 path multiplier ÷ 3 mph
// walking speed, floored at 1 minute.
//
// The 1.3 multiplier compensates for paths that wind around lands, walls,
// and queue overflows — most paths in DLR/DCA come within 20-30% of the
// straight line. Good enough for v2; we can switch to a hand-built path
// graph later if the LLM starts making distance-sensitive bad calls.

const PATH_MULTIPLIER = 1.3;
const WALKING_METERS_PER_MIN = 80.5; // ~3 mph
const EARTH_RADIUS_METERS = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance in meters between two lat/lng pairs.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

/**
 * Estimated walking minutes between two points. Returns `null` when either
 * input pair is missing lat/lng — the caller decides whether to omit the
 * walk-time pill or skip the ride entirely.
 *
 * Floored at 1 minute so adjacent rides never read as "0 min walk" (which
 * is awkward and implies teleportation).
 */
export function walkingMinutes(
  from: { lat: number | null; lng: number | null } | null,
  to: { lat: number | null; lng: number | null } | null
): number | null {
  if (!from || !to) return null;
  if (
    from.lat === null || from.lng === null ||
    to.lat === null || to.lng === null
  ) {
    return null;
  }
  const meters = haversineMeters(from.lat, from.lng, to.lat, to.lng) * PATH_MULTIPLIER;
  const minutes = meters / WALKING_METERS_PER_MIN;
  return Math.max(1, Math.round(minutes));
}
