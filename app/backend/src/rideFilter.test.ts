import { filterToRides } from './rideFilter';
import { ThemeparksLiveEntity } from './types';

describe('filterToRides', () => {
  it('keeps ATTRACTION entities and drops shows, restaurants, parades, and meet-and-greets', () => {
    const entities: ThemeparksLiveEntity[] = [
      { id: '1', name: 'Space Mountain', entityType: 'ATTRACTION' },
      { id: '2', name: 'Fantasmic', entityType: 'SHOW' },
      { id: '3', name: 'Blue Bayou', entityType: 'RESTAURANT' },
      { id: '4', name: 'Christmas Parade', entityType: 'PARADE' },
      { id: '5', name: 'Indiana Jones', entityType: 'ATTRACTION' },
      { id: '6', name: 'Pin Trading', entityType: 'MEET_AND_GREET' },
    ];

    const result = filterToRides(entities);

    expect(result.map(r => r.name)).toEqual(['Space Mountain', 'Indiana Jones']);
  });

  it('returns an empty array when given no entities', () => {
    expect(filterToRides([])).toEqual([]);
  });
});
