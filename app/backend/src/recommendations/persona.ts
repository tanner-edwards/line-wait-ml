// Translates a v3 Persona into the natural-language <persona> block consumed
// by the LLM system prompt. Each field becomes a short paragraph only when
// it carries a signal; skipped fields emit nothing. If every field is empty
// (or the persona is null), we fall back to the v2 DEFAULT_PERSONA so the
// engine continues to work for users who haven't done intake.

import {
  AccessibilityNeed,
  Persona,
  RideCategory,
  RideMetadata,
  TripDuration,
} from '../types';
import { DEFAULT_PERSONA } from './promptBuilder';

const TRIP_DURATION_TEXT: Record<TripDuration, string> = {
  '1-day':
    'Single-day visit — every recommendation matters; this is the only chance for the headliners.',
  '2-days':
    'Two-day visit — moderate pace, can spread the must-do rides across both days.',
  '3-4-days':
    'Three-to-four day visit — relaxed pace, plenty of time to cover both parks.',
  '5-plus-days':
    'Extended five-or-more day visit — very relaxed pace; willing to explore lesser-known attractions.',
};

const RIDE_CATEGORY_TEXT: Record<Exclude<RideCategory, 'first-time'>, string> = {
  thrills:
    'thrill rides (coasters, drops, high-intensity)',
  classics:
    'classic Disney attractions (Pirates, Haunted Mansion, Jungle Cruise, Indiana Jones, etc.)',
  immersive:
    'newer immersive / story-driven attractions (Rise of the Resistance, Web Slingers, Smugglers Run, Radiator Springs Racers, etc.)',
  'kid-favorites':
    'gentle rides for young kids (carousels, Dumbo, Casey Jr., Little Mermaid, etc.)',
  'shows-characters':
    'shows, parades, and character meet-and-greets',
};

const ACCESSIBILITY_TEXT: Record<Exclude<AccessibilityNeed, 'none'>, string> = {
  stroller:
    'Party is traveling with a stroller — flag attractions that require stroller transfer when relevant.',
  wheelchair:
    'Party member uses a wheelchair or mobility scooter — avoid attractions that require transferring out of the wheelchair when comparable options exist.',
  pregnant:
    'A pregnant guest is in the party — do not recommend severe drops, high-G coasters, spinning rides, or otherwise rough thrills.',
  sensory:
    'A guest in the party has sensory sensitivities (may be using DAS) — be mindful of attractions with intense strobes, loud audio, or sudden drops.',
};

const RIDER_SWAP_NOTE =
  ' Rider swap is an option when there are multiple adults — feel free to recommend a height-restricted headliner if the group can pivot, but do not assume it; lean default toward rides everyone can do together.';

function ageText(age: number): string {
  if (age >= 18) {
    return 'All adults in the party — no height restrictions to worry about; the full thrill catalog is available.';
  }
  if (age <= 3) {
    return `Youngest in the party is a toddler (age ${age}). Most height-restricted thrill rides are off the table. Pace should account for short attention spans and nap windows. Lean toward gentle dark rides, carousels, and character experiences.${RIDER_SWAP_NOTE}`;
  }
  if (age <= 6) {
    return `Youngest in the party is a young child (age ${age}). Several headliner thrills (Space Mountain, Indiana Jones, Matterhorn, Incredicoaster, Guardians of the Galaxy, Tower of Terror) have height restrictions that exclude this age. Lean toward family-friendly dark rides and shows for the whole-party picks.${RIDER_SWAP_NOTE}`;
  }
  if (age <= 12) {
    return `Youngest in the party is age ${age}. Most attractions are accessible; only the very tallest thrills (Indiana Jones at 46", Incredicoaster at 48", Guardians at 42") may be borderline — recommend with care if the child is small for their age.`;
  }
  return `Youngest in the party is a teen (age ${age}). All attractions are height-accessible.`;
}

export function personaToText(
  persona: Persona | null | undefined,
  rideMetadata: Map<string, RideMetadata>
): string {
  if (!persona) return DEFAULT_PERSONA;

  const parts: string[] = [];

  if (persona.tripDuration) {
    parts.push(TRIP_DURATION_TEXT[persona.tripDuration]);
  }

  if (persona.youngestAge !== null && Number.isFinite(persona.youngestAge)) {
    parts.push(ageText(persona.youngestAge));
  }

  if (persona.ridePreferences.length > 0) {
    if (persona.ridePreferences.includes('first-time')) {
      parts.push(
        "This is the guest's first visit to the park. Prioritize iconic, must-do attractions over obscure picks. Explain briefly what each ride is — they don't know the lore yet. Don't assume park knowledge."
      );
    }
    const otherPrefs = persona.ridePreferences.filter(
      (p): p is Exclude<RideCategory, 'first-time'> => p !== 'first-time'
    );
    if (otherPrefs.length > 0) {
      const labels = otherPrefs.map(p => RIDE_CATEGORY_TEXT[p]).join('; ');
      parts.push(
        `Ride preferences: ${labels}. Weight these categories more heavily when ranking.`
      );
    }
  }

  if (persona.mustDoRideIds.length > 0) {
    const names = persona.mustDoRideIds
      .map(id => rideMetadata.get(id)?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (names.length > 0) {
      parts.push(
        `Must-do rides this trip: ${names.join(', ')}. Any reasonably short wait on these is a hair-on-fire opportunity — rank them very high when the timing window is open.`
      );
    }
  }

  for (const need of persona.accessibilityNeeds) {
    if (need !== 'none') {
      parts.push(ACCESSIBILITY_TEXT[need]);
    }
  }

  if (parts.length === 0) return DEFAULT_PERSONA;
  return parts.join('\n\n');
}

// Stable key for caching: skipped fields drop out, arrays are sorted so the
// same answers produce the same key regardless of selection order.
export function personaCacheKey(persona: Persona | null | undefined): string {
  if (!persona) return 'default';
  const normalized = {
    tripDuration: persona.tripDuration ?? null,
    youngestAge: persona.youngestAge ?? null,
    ridePreferences: [...persona.ridePreferences].sort(),
    mustDoRideIds: [...persona.mustDoRideIds].sort(),
    accessibilityNeeds: [...persona.accessibilityNeeds].sort(),
  };
  return JSON.stringify(normalized);
}
