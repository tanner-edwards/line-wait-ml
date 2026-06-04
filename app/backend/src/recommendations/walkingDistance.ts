// Walking-distance estimate between two ride locations inside a Disney park.
//
// Approach: haversine straight-line distance × tiered path multiplier ÷ 3 mph
// walking speed, floored at 1 minute.
//
// The multiplier is tiered by straight-line distance to reflect that longer
// cross-park walks involve more crowd navigation, land transitions, and
// psychological cost than the raw haversine implies:
//   < 366 m (~400 yd)  → 1.3×  same land or adjacent
//   366–640 m           → 1.6×  cross-land trek
//   640+ m              → 2.0×  full park crossing

const WALKING_METERS_PER_MIN = 80.5; // ~3 mph
const EARTH_RADIUS_METERS = 6_371_000;
const METERS_TO_YARDS = 1.09361;

// Straight-line thresholds for multiplier tiers (meters)
const MEDIUM_WALK_THRESHOLD = 366;  // ~400 yards
const LONG_WALK_THRESHOLD   = 640;  // ~700 yards

function pathMultiplier(haversine: number): number {
  if (haversine >= LONG_WALK_THRESHOLD)   return 2.0;
  if (haversine >= MEDIUM_WALK_THRESHOLD) return 1.6;
  return 1.3;
}

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
  to: { lat: number | null; lng: number | null } | null,
  penaltyMinutes = 0
): number | null {
  const meters = pathMeters(from, to);
  if (meters === null) return null;
  return Math.max(1, Math.round(meters / WALKING_METERS_PER_MIN)) + penaltyMinutes;
}

/**
 * Estimated walking distance in YARDS between two points (path-adjusted, so
 * not straight-line). Same null semantics as walkingMinutes — useful for
 * the DebugCard, which wants a tangible "how far" alongside the time.
 */
export function walkingYards(
  from: { lat: number | null; lng: number | null } | null,
  to: { lat: number | null; lng: number | null } | null
): number | null {
  const meters = pathMeters(from, to);
  if (meters === null) return null;
  return Math.max(1, Math.round(meters * METERS_TO_YARDS));
}

function pathMeters(
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
  const raw = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  return raw * pathMultiplier(raw);
}
