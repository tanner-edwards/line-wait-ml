import { flattenForList, flattenSorted, rideWaitLabel } from './grouping';
import { CombinedResponse, Persona, Ride } from './types';
import { personaScore, typicalHeightInches } from './personaSort';

function makePersona(over: Partial<Persona> = {}): Persona {
  return {
    tripDuration: null,
    youngestAge: null,
    ridePreferences: [],
    mustDoRideIds: [],
    accessibilityNeeds: [],
    ...over,
  };
}

// Ride-name order out of the opportunity sort (rides only), single park.
function opportunityOrder(rides: Ride[], persona: Persona | null): string[] {
  const resp: CombinedResponse = {
    parks: [{ park: 'Disneyland', lastUpdated: '2026-05-15T20:00:00Z', rides }],
  };
  return flattenSorted(resp, 'opportunity', null, persona)
    .filter(i => i.kind === 'ride')
    .map(i => (i.kind === 'ride' ? i.ride.name : ''));
}

const GO = { badge: 'go' } as Ride['score'];
const STAR = { badge: 'star' } as Ride['score'];

function makeRide(over: Partial<Ride> = {}): Ride {
  const base: Ride = {
    id: 'rid',
    name: 'A Ride',
    land: 'Fantasyland',
    status: 'OPERATING',
    currentWait: 10,
    historicalAverage: null,
    rideStats: null,
    prediction: null,
    recentHistory: null,
    lat: null,
    lng: null,
  };
  return { ...base, ...over };
}

describe('flattenForList', () => {
  it('preserves park order: Disneyland first, then Disney California Adventure', () => {
    const resp: CombinedResponse = {
      parks: [
        { park: 'Disneyland', lastUpdated: '2026-05-15T20:00:00Z', rides: [] },
        { park: 'Disney California Adventure', lastUpdated: '2026-05-15T20:00:00Z', rides: [] },
      ],
    };
    const items = flattenForList(resp);
    expect(items.map(i => (i.kind === 'park-header' ? i.park : null)).filter(Boolean)).toEqual([
      'Disneyland',
      'Disney California Adventure',
    ]);
  });

  it('groups rides by land, sorts lands alphabetically within a park, and sorts rides alphabetically within each land', () => {
    const resp: CombinedResponse = {
      parks: [
        {
          park: 'Disneyland',
          lastUpdated: '2026-05-15T20:00:00Z',
          rides: [
            makeRide({ id: '1', name: 'Space Mountain', land: 'Tomorrowland' }),
            makeRide({ id: '2', name: 'Peter Pan', land: 'Fantasyland' }),
            makeRide({ id: '3', name: 'Astro Orbitor', land: 'Tomorrowland' }),
            makeRide({ id: '4', name: 'Indiana Jones', land: 'Adventureland' }),
            makeRide({ id: '5', name: 'Alice in Wonderland', land: 'Fantasyland' }),
          ],
        },
      ],
    };

    const order = flattenForList(resp).map(i => {
      if (i.kind === 'park-header') return `P:${i.park}`;
      if (i.kind === 'land-header') return `L:${i.land}`;
      return `R:${i.ride.name}`;
    });

    expect(order).toEqual([
      'P:Disneyland',
      'L:Adventureland',
      'R:Indiana Jones',
      'L:Fantasyland',
      'R:Alice in Wonderland',
      'R:Peter Pan',
      'L:Tomorrowland',
      'R:Astro Orbitor',
      'R:Space Mountain',
    ]);
  });

  it('places non-OPERATING rides after OPERATING rides within the same land', () => {
    const resp: CombinedResponse = {
      parks: [
        {
          park: 'Disneyland',
          lastUpdated: '2026-05-15T20:00:00Z',
          rides: [
            makeRide({ id: '1', name: 'Zebra Coaster', land: 'Fantasyland', status: 'OPERATING' }),
            makeRide({ id: '2', name: 'Alpha Closed', land: 'Fantasyland', status: 'CLOSED' }),
            makeRide({ id: '3', name: 'Beta Refurb', land: 'Fantasyland', status: 'REFURBISHMENT' }),
            makeRide({ id: '4', name: 'Charlie Open', land: 'Fantasyland', status: 'OPERATING' }),
          ],
        },
      ],
    };

    const rideOrder = flattenForList(resp)
      .filter(i => i.kind === 'ride')
      .map(i => (i.kind === 'ride' ? i.ride.name : ''));

    // Operating first (alpha), then closed/refurb (alpha)
    expect(rideOrder).toEqual([
      'Charlie Open',
      'Zebra Coaster',
      'Alpha Closed',
      'Beta Refurb',
    ]);
  });

  it('renders an errored park header with errored=true and no rides', () => {
    const resp: CombinedResponse = {
      parks: [
        {
          park: 'Disneyland',
          lastUpdated: '2026-05-15T20:00:00Z',
          rides: [makeRide({ id: '1', name: 'Space Mountain', land: 'Tomorrowland' })],
        },
        {
          park: 'Disney California Adventure',
          lastUpdated: null,
          rides: [],
          error: 'UPSTREAM_UNAVAILABLE',
        },
      ],
    };

    const items = flattenForList(resp);
    const dlHeader = items.find(i => i.kind === 'park-header' && i.park === 'Disneyland');
    const dcaHeader = items.find(i => i.kind === 'park-header' && i.park === 'Disney California Adventure');

    expect(dlHeader).toMatchObject({ kind: 'park-header', errored: false });
    expect(dcaHeader).toMatchObject({ kind: 'park-header', errored: true });

    // DCA has no land/ride entries between its header and the end of the list
    const dcaIdx = items.indexOf(dcaHeader!);
    expect(items.slice(dcaIdx + 1)).toEqual([]);
  });
});

describe('rideWaitLabel', () => {
  it('returns "<n> min" for an operating ride with a numeric wait', () => {
    expect(rideWaitLabel(makeRide({ status: 'OPERATING', currentWait: 45 }))).toBe('45 min');
  });

  it('returns "—" for an operating ride with a null wait', () => {
    expect(rideWaitLabel(makeRide({ status: 'OPERATING', currentWait: null }))).toBe('—');
  });

  it('returns "Closed" for non-operating statuses regardless of wait', () => {
    expect(rideWaitLabel(makeRide({ status: 'CLOSED', currentWait: null }))).toBe('Closed');
    expect(rideWaitLabel(makeRide({ status: 'DOWN', currentWait: null }))).toBe('Closed');
  });

  it('returns "Refurbishment" for rides in scheduled refurb', () => {
    expect(rideWaitLabel(makeRide({ status: 'REFURBISHMENT', currentWait: null }))).toBe('Refurbishment');
  });
});

describe('personaScore', () => {
  it('returns 0 for a null persona', () => {
    expect(personaScore(makeRide({ id: 'x' }), null)).toBe(0);
  });

  it('returns 0 for an empty persona (no-op)', () => {
    expect(personaScore(makeRide({ id: 'x', categories: ['thrills'], thrillLevel: 5 }), makePersona())).toBe(0);
  });

  it('gives must-do the dominant +100', () => {
    const ride = makeRide({ id: 'must', categories: ['thrills'] });
    expect(personaScore(ride, makePersona({ mustDoRideIds: ['must'], ridePreferences: ['thrills'] }))).toBe(110);
  });

  it('adds +10 per matched selected category', () => {
    const ride = makeRide({ id: 'r', categories: ['thrills', 'classics', 'immersive'] });
    expect(personaScore(ride, makePersona({ ridePreferences: ['thrills', 'classics'] }))).toBe(20);
    expect(personaScore(ride, makePersona({ ridePreferences: ['kid-favorites'] }))).toBe(0);
  });

  it('subtracts 5 when the youngest cannot clear the height minimum', () => {
    const tall = makeRide({ id: 'r', heightMinIn: 48 });
    expect(personaScore(tall, makePersona({ youngestAge: 4 }))).toBe(-5); // 4yr ≈ 40" < 48"
    expect(personaScore(tall, makePersona({ youngestAge: 12 }))).toBe(0); // 12yr ≈ 58" ≥ 48"
    expect(personaScore(tall, makePersona({ youngestAge: null }))).toBe(0);
  });

  it('subtracts 20 per accessibility conflict', () => {
    const intense = makeRide({ id: 'r', thrillLevel: 5, pregnancyAdvisory: true, transferRequired: true });
    expect(personaScore(intense, makePersona({ accessibilityNeeds: ['sensory'] }))).toBe(-20);
    expect(personaScore(intense, makePersona({ accessibilityNeeds: ['pregnant', 'wheelchair'] }))).toBe(-40);
    const mild = makeRide({ id: 'r', thrillLevel: 2 });
    expect(personaScore(mild, makePersona({ accessibilityNeeds: ['sensory'] }))).toBe(0);
  });

  it('typicalHeightInches treats 13+ as adult', () => {
    expect(typicalHeightInches(13)).toBeGreaterThanOrEqual(60);
    expect(typicalHeightInches(4)).toBeLessThan(48);
  });
});

describe('flattenSorted — persona level', () => {
  it('reorders within an opportunity tier by persona (must-do floats up)', () => {
    const rides = [
      makeRide({ id: 'a', name: 'Alpha', score: GO }),
      makeRide({ id: 'b', name: 'Bravo', score: GO }),
    ];
    // No persona → alphabetical within tier.
    expect(opportunityOrder(rides, null)).toEqual(['Alpha', 'Bravo']);
    // Bravo is a must-do → floats above Alpha (same tier).
    expect(opportunityOrder(rides, makePersona({ mustDoRideIds: ['b'] }))).toEqual(['Bravo', 'Alpha']);
  });

  it('never lets persona cross an opportunity tier boundary', () => {
    const rides = [
      makeRide({ id: 'star', name: 'StarRide', score: STAR }),        // better tier, not a must-do
      makeRide({ id: 'go', name: 'GoRide', score: GO }),              // worse tier, IS a must-do
    ];
    // Must-do GoRide gets +100 but STAR still outranks GO — badge wins.
    expect(opportunityOrder(rides, makePersona({ mustDoRideIds: ['go'] }))).toEqual(['StarRide', 'GoRide']);
  });

  it('ranks more category matches higher within a tier', () => {
    const rides = [
      makeRide({ id: 'one', name: 'OneMatch', score: GO, categories: ['thrills'] }),
      makeRide({ id: 'two', name: 'TwoMatch', score: GO, categories: ['thrills', 'immersive'] }),
    ];
    expect(opportunityOrder(rides, makePersona({ ridePreferences: ['thrills', 'immersive'] })))
      .toEqual(['TwoMatch', 'OneMatch']);
  });

  it('empty persona reproduces the non-personalized order', () => {
    const rides = [
      makeRide({ id: 'a', name: 'Zeta', score: GO }),
      makeRide({ id: 'b', name: 'Alpha', score: GO }),
    ];
    expect(opportunityOrder(rides, makePersona())).toEqual(opportunityOrder(rides, null));
  });
});
