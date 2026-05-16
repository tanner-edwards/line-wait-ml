import { ThemeparksLiveEntity } from './types';

export function filterToRides(
  entities: ThemeparksLiveEntity[]
): ThemeparksLiveEntity[] {
  return entities.filter(e => e.entityType === 'ATTRACTION');
}
