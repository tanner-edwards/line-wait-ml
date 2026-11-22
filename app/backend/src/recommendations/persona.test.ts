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

  it('names the deciding ride-line field per category and states the one-step boost', () => {
    const out = personaToText({ ...emptyPersona(), ridePreferences: ['thrills', 'classics'] }, new Map());
    expect(out).toContain('thrill 3 or higher');
    expect(out).toContain('tagged classic');
    expect(out).toContain('one step better than its verdict');
    expect(out).toContain('not a filter');
    expect(out).not.toMatch(/Indiana Jones|Pirates/); // membership comes from the tags, not a list
  });

  it('treats every category selected as no preference at all', () => {
    const out = personaToText({ ...emptyPersona(), ridePreferences: ['thrills', 'classics', 'immersive', 'kid-favorites'] }, new Map());
    expect(out).toBe(DEFAULT_PERSONA);
    const withFirst = personaToText({ ...emptyPersona(), ridePreferences: ['thrills', 'classics', 'immersive', 'kid-favorites', 'first-time'] }, new Map());
    expect(withFirst).toMatch(/first visit/);
    expect(withFirst).not.toContain('Ride preferences:');
  });

  it('no longer emits a must-do sentence (wanted travels on the ride line)', () => {
    const out = personaToText(
      { ...emptyPersona(), tripDuration: '1-day', mustDoRideIds: ['ride-rise', 'ride-indy'] },
      META
    );
    expect(out).not.toMatch(/must-do rides this trip/i);
    expect(out).not.toContain('Rise of the Resistance');
    expect(out).not.toContain('Indiana Jones Adventure');
    expect(out).not.toMatch(/hair-on-fire/i);
  });

  it('returns DEFAULT_PERSONA when must-do rides are the only signal', () => {
    const out = personaToText({ ...emptyPersona(), mustDoRideIds: ['ride-rise'] }, META);
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

  it('still varies with mustDoRideIds (and ignores their order)', () => {
    const none = personaCacheKey(emptyPersona());
    const rise = personaCacheKey({ ...emptyPersona(), mustDoRideIds: ['ride-rise'] });
    const both = personaCacheKey({ ...emptyPersona(), mustDoRideIds: ['ride-rise', 'ride-indy'] });
    const bothReordered = personaCacheKey({ ...emptyPersona(), mustDoRideIds: ['ride-indy', 'ride-rise'] });
    expect(rise).not.toBe(none);
    expect(both).not.toBe(rise);
    expect(both).toBe(bothReordered);
  });

  it('returns different keys for different content', () => {
    const a: Persona = { ...emptyPersona(), youngestAge: 5 };
    const b: Persona = { ...emptyPersona(), youngestAge: 10 };
    expect(personaCacheKey(a)).not.toBe(personaCacheKey(b));
  });
});
