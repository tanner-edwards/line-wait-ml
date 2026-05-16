import { resolveLand } from './landResolver';

describe('resolveLand', () => {
  // These UUIDs come from the static landMapping for the corresponding parks.
  // If the mapping is ever overhauled, update these to match.
  const HYPERSPACE_MTN_ID = '9167db1d-e5e7-46da-a07f-ae30a87bc4c4';
  const PETER_PAN_ID = 'c23af6ba-8515-406a-8a48-d0818ba0bfc9';
  const RADIATOR_SPRINGS_ID = 'c60c768b-3461-465c-8f4f-b44b087506fc';

  it('resolves a known Disneyland ride to its land name', () => {
    expect(resolveLand(HYPERSPACE_MTN_ID, 'disneyland')).toBe('Tomorrowland');
    expect(resolveLand(PETER_PAN_ID, 'disneyland')).toBe('Fantasyland');
  });

  it('resolves a known DCA ride to its land name', () => {
    expect(resolveLand(RADIATOR_SPRINGS_ID, 'california-adventure')).toBe('Cars Land');
  });

  it('returns "Other" for an unknown ride id in either park', () => {
    expect(resolveLand('not-a-real-uuid', 'disneyland')).toBe('Other');
    expect(resolveLand('not-a-real-uuid', 'california-adventure')).toBe('Other');
  });

  it('keeps park namespaces separate — a Disneyland id is "Other" for DCA', () => {
    expect(resolveLand(HYPERSPACE_MTN_ID, 'california-adventure')).toBe('Other');
  });
});
