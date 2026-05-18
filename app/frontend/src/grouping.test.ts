import { flattenForList, rideWaitLabel } from './grouping';
import { CombinedResponse, Ride } from './types';

function makeRide(over: Partial<Ride> = {}): Ride {
  const base: Ride = {
    id: 'rid',
    name: 'A Ride',
    land: 'Fantasyland',
    status: 'OPERATING',
    currentWait: 10,
    historicalAverage: null,
    prediction: null,
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
    expect(rideWaitLabel(makeRide({ status: 'REFURBISHMENT', currentWait: 30 }))).toBe('Closed');
    expect(rideWaitLabel(makeRide({ status: 'DOWN', currentWait: null }))).toBe('Closed');
  });
});
