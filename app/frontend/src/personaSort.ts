import { Persona, Ride } from './types';

// Typical height in inches by age in years (~50th percentile), used to decide
// whether the youngest in the party clears a ride's height minimum. Ages >= 13
// are treated as adults (clear any ride). Deliberately approximate — tune as
// real-world edge cases surface.
const TYPICAL_HEIGHT_IN: Record<number, number> = {
  0: 24, 1: 30, 2: 34, 3: 37, 4: 40, 5: 43,
  6: 45, 7: 48, 8: 50, 9: 52, 10: 54, 11: 56, 12: 58,
};

export function typicalHeightInches(age: number): number {
  if (age >= 13) return 72; // adult — clears every ride
  if (age <= 0) return TYPICAL_HEIGHT_IN[0];
  return TYPICAL_HEIGHT_IN[age] ?? 72;
}

/**
 * Deterministic personalization score for the Opportunity sort's persona level.
 * Higher scores rank first WITHIN an opportunity tier — persona never crosses
 * tier boundaries (that's the badge's job). Returns 0 for a null or empty
 * persona, so the sort collapses to its non-personalized behavior.
 *
 * Score = +100 must-do
 *       + 10 per selected ride-preference category this ride matches
 *       −  5 if the youngest can't clear the ride's height minimum
 *       − 20 per accessibility conflict
 */
export function personaScore(ride: Ride, persona: Persona | null): number {
  if (!persona) return 0;
  let score = 0;

  // Must-do: the dominant personal signal — floats to the top of its tier.
  if (persona.mustDoRideIds.includes(ride.id)) score += 100;

  // Category fit: +10 for each selected preference this ride belongs to.
  const cats = ride.categories ?? [];
  for (const pref of persona.ridePreferences) {
    if (cats.includes(pref)) score += 10;
  }

  // Age/height: youngest in the party can't clear this ride's height minimum.
  // A mild nudge — adults can still ride via rider-swap.
  if (persona.youngestAge != null && ride.heightMinIn != null) {
    if (typicalHeightInches(persona.youngestAge) < ride.heightMinIn) score -= 5;
  }

  // Accessibility conflicts. "Intense" mirrors the thrills heuristic.
  const intense = ride.thrillLevel != null && ride.thrillLevel >= 4;
  for (const need of persona.accessibilityNeeds) {
    if (need === 'pregnant' && (ride.pregnancyAdvisory || intense)) score -= 20;
    else if (need === 'wheelchair' && ride.transferRequired) score -= 20;
    else if (need === 'sensory' && intense) score -= 20;
  }

  return score;
}
