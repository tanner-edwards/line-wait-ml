import { personaToText, personaCacheKey } from './persona';
import { DEFAULT_PERSONA } from './promptBuilder';
import { Persona, RideMetadata } from '../types';

const META = new Map<string, RideMetadata>([
  ['ride-rise', { rideId: 'ride-rise', parkId: 'p', name: 'Rise of the Resistance', lat: null, lng: null, source: 'manual' }],
  ['ride-indy', { rideId: 'ride-indy', parkId: 'p', name: 'Indiana Jones Adventure', lat: null, lng: null, source: 'manual' }],
]);

function emptyPersona(): Persona {
  return {
    tripDuration: null,
    youngestAge: null,
    ridePreferences: [],
    mustDoRideIds: [],
    accessibilityNeeds: [],
  };
}

describe('personaToText', () => {
  it('returns DEFAULT_PERSONA when persona is null', () => {
    expect(personaToText(null, META)).toBe(DEFAULT_PERSONA);
  });

  it('returns DEFAULT_PERSONA when persona is undefined', () => {
    expect(personaToText(undefined, META)).toBe(DEFAULT_PERSONA);
  });

  it('returns DEFAULT_PERSONA when every field is empty/null', () => {
    expect(personaToText(emptyPersona(), META)).toBe(DEFAULT_PERSONA);
  });

  it('emits trip duration text when set', () => {
    const out = personaToText({ ...emptyPersona(), tripDuration: '1-day' }, META);
    expect(out).toContain('Single-day');
    expect(out).not.toBe(DEFAULT_PERSONA);
  });

  it('emits toddler-aware text when youngest age is 2', () => {
    const out = personaToText({ ...emptyPersona(), youngestAge: 2 }, META);
    expect(out).toMatch(/toddler/i);
    expect(out).toContain('age 2');
  });

  it('emits young-child text when youngest age is 5', () => {
    const out = personaToText({ ...emptyPersona(), youngestAge: 5 }, META);
    expect(out).toMatch(/young child/i);
    expect(out).toContain('age 5');
    expect(out).toContain('Space Mountain');  // mentions height-restricted rides
  });

  it('emits all-adults text when youngest age is 18+', () => {
    const out = personaToText({ ...emptyPersona(), youngestAge: 18 }, META);
    expect(out).toMatch(/all adults/i);
  });

  it('emits teen text when youngest age is between 13 and 17', () => {
    const out = personaToText({ ...emptyPersona(), youngestAge: 15 }, META);
    expect(out).toMatch(/teen/i);
    expect(out).toContain('age 15');
  });

  it('emits first-time guidance separately from category guidance', () => {
    const out = personaToText(
      { ...emptyPersona(), ridePreferences: ['first-time', 'thrills'] },
      META
    );
    expect(out).toMatch(/first visit/i);
    expect(out).toContain('thrill rides');
  });

  it('looks up must-do ride names from metadata', () => {
    const out = personaToText(
      { ...emptyPersona(), mustDoRideIds: ['ride-rise', 'ride-indy'] },
      META
    );
    expect(out).toContain('Rise of the Resistance');
    expect(out).toContain('Indiana Jones Adventure');
    expect(out).toMatch(/hair-on-fire/i);
  });

  it('skips must-do entries whose IDs are unknown', () => {
    const out = personaToText(
      { ...emptyPersona(), mustDoRideIds: ['ride-rise', 'ride-bogus'] },
      META
    );
    expect(out).toContain('Rise of the Resistance');
    expect(out).not.toContain('ride-bogus');
  });

  it('returns DEFAULT_PERSONA when must-do list is entirely unknown IDs', () => {
    const out = personaToText({ ...emptyPersona(), mustDoRideIds: ['ride-bogus'] }, META);
    expect(out).toBe(DEFAULT_PERSONA);
  });

  it('emits accessibility guidance for each non-"none" need', () => {
    const out = personaToText(
      { ...emptyPersona(), accessibilityNeeds: ['stroller', 'pregnant'] },
      META
    );
    expect(out).toMatch(/stroller/i);
    expect(out).toMatch(/pregnant/i);
  });

  it('ignores "none" accessibility need', () => {
    const out = personaToText({ ...emptyPersona(), accessibilityNeeds: ['none'] }, META);
    expect(out).toBe(DEFAULT_PERSONA);
  });

  it('joins multiple field outputs with blank-line separators', () => {
    const out = personaToText(
      {
        ...emptyPersona(),
        tripDuration: '2-days',
        youngestAge: 8,
        accessibilityNeeds: ['stroller'],
      },
      META
    );
    expect(out.split('\n\n').length).toBeGreaterThanOrEqual(3);
  });
});

describe('personaCacheKey', () => {
  it('returns "default" for null persona', () => {
    expect(personaCacheKey(null)).toBe('default');
  });

  it('returns the same key for the same persona regardless of array order', () => {
    const a: Persona = {
      ...emptyPersona(),
      ridePreferences: ['thrills', 'classics'],
      accessibilityNeeds: ['stroller', 'pregnant'],
    };
    const b: Persona = {
      ...emptyPersona(),
      ridePreferences: ['classics', 'thrills'],
      accessibilityNeeds: ['pregnant', 'stroller'],
    };
    expect(personaCacheKey(a)).toBe(personaCacheKey(b));
  });

  it('returns different keys for different content', () => {
    const a: Persona = { ...emptyPersona(), youngestAge: 5 };
    const b: Persona = { ...emptyPersona(), youngestAge: 10 };
    expect(personaCacheKey(a)).not.toBe(personaCacheKey(b));
  });
});
