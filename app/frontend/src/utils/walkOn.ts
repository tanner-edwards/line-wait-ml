const WALK_ON_FLOORS: Record<string, number> = {
  'ff52cb64-c1d5-4feb-9d43-5dbd429bac81': 13, // Haunted Mansion
};

export function getWalkOnFloor(rideId: string): number {
  return WALK_ON_FLOORS[rideId] ?? 5;
}

export function isWalkOnRide(rideId: string, currentWait: number | null): boolean {
  if (currentWait === null) return false;
  return currentWait <= getWalkOnFloor(rideId);
}
