// Persona presets for live-random runs (`npm run eval -- --live disneyland`).
//
// Every preset runs against the SAME sampled ride set in one run, so the only thing that
// changes between fixtures is the party. `wanted` is how many of the sampled rides the
// preset marks as wanted; the sampler draws one wanted list per run and each preset takes
// the first `wanted` of it, so presets that want rides want the same ones.
import { Persona } from '../../app/backend/src/types';

export interface PersonaPreset {
  key: string;
  label: string;
  persona: Persona | null;
  wanted: number;
}

const base: Persona = { tripDuration: null, youngestAge: null, ridePreferences: [], mustDoRideIds: [], accessibilityNeeds: [] };

export const PERSONA_PRESETS: PersonaPreset[] = [
  { key: 'default', label: 'Default guest, nothing marked', persona: null, wanted: 0 },
  { key: 'thrills', label: 'Two adults, thrills, two rides marked', persona: { ...base, youngestAge: 18, ridePreferences: ['thrills'], tripDuration: '1-day' }, wanted: 2 },
  { key: 'toddler', label: 'Toddler (3) with a stroller, one ride marked', persona: { ...base, youngestAge: 3, ridePreferences: ['kid-favorites'], accessibilityNeeds: ['stroller'], tripDuration: '2-days' }, wanted: 1 },
  { key: 'pregnant', label: 'Pregnant guest, partner likes thrills, one ride marked', persona: { ...base, youngestAge: 18, ridePreferences: ['thrills'], accessibilityNeeds: ['pregnant'] }, wanted: 1 },
  { key: 'big-kid', label: 'Two adults and a 10-year-old, nothing marked', persona: { ...base, youngestAge: 10, tripDuration: '2-days' }, wanted: 0 },
  { key: 'first-visit', label: 'First visit, kid of 8, classics, one ride marked', persona: { ...base, youngestAge: 8, ridePreferences: ['first-time', 'classics'], tripDuration: '1-day' }, wanted: 1 },
  { key: 'wheelchair', label: 'Wheelchair in the party, immersive, one ride marked', persona: { ...base, youngestAge: 18, ridePreferences: ['immersive'], accessibilityNeeds: ['wheelchair'], tripDuration: '3-4-days' }, wanted: 1 },
];

export function presetsByKey(keys?: string[]): PersonaPreset[] {
  if (!keys?.length) return PERSONA_PRESETS;
  return keys.map(k => {
    const p = PERSONA_PRESETS.find(x => x.key === k);
    if (!p) throw new Error(`Unknown persona preset "${k}". Available: ${PERSONA_PRESETS.map(x => x.key).join(', ')}`);
    return p;
  });
}
