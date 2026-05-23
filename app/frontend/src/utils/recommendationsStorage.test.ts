// AsyncStorage's native module is unavailable in jest; use the library's
// official in-memory mock per its testing docs.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  STALE_THRESHOLD_MS,
  _resetForTests,
  getLastSelection,
  isStale,
  setLastSelection,
} from './recommendationsStorage';

beforeEach(async () => {
  await _resetForTests();
});

describe('setLastSelection / getLastSelection roundtrip', () => {
  it('returns null when nothing is stored', async () => {
    expect(await getLastSelection()).toBeNull();
  });

  it('persists and retrieves a valid selection', async () => {
    await setLastSelection('disneyland', 'ride-uuid-1');
    const got = await getLastSelection();
    expect(got).not.toBeNull();
    expect(got!.park).toBe('disneyland');
    expect(got!.currentRideId).toBe('ride-uuid-1');
    expect(got!.timestamp).toBeGreaterThan(0);
  });

  it('overwrites the previous selection on a second set', async () => {
    await setLastSelection('disneyland', 'first');
    await setLastSelection('california-adventure', 'second');
    const got = await getLastSelection();
    expect(got!.park).toBe('california-adventure');
    expect(got!.currentRideId).toBe('second');
  });

  it('returns null when storage holds malformed JSON', async () => {
    await AsyncStorage.setItem('club32:recommendations:lastSelection', '{not-json');
    expect(await getLastSelection()).toBeNull();
  });

  it('returns null when stored object is missing fields', async () => {
    await AsyncStorage.setItem(
      'club32:recommendations:lastSelection',
      JSON.stringify({ park: 'disneyland' /* no currentRideId / timestamp */ })
    );
    expect(await getLastSelection()).toBeNull();
  });

  it('returns null when park is not a valid slug', async () => {
    await AsyncStorage.setItem(
      'club32:recommendations:lastSelection',
      JSON.stringify({ park: 'tokyo-disneyland', currentRideId: 'x', timestamp: 1 })
    );
    expect(await getLastSelection()).toBeNull();
  });
});

describe('isStale', () => {
  it('treats null as stale (no persisted selection)', () => {
    expect(isStale(null)).toBe(true);
  });

  it('returns false when the selection is younger than the threshold', () => {
    const now = 1_000_000_000_000;
    const fresh = { park: 'disneyland' as const, currentRideId: 'r', timestamp: now - 30 * 60 * 1000 };
    expect(isStale(fresh, now)).toBe(false);
  });

  it('returns true when the selection is at or past the threshold', () => {
    const now = 1_000_000_000_000;
    const stale = { park: 'disneyland' as const, currentRideId: 'r', timestamp: now - STALE_THRESHOLD_MS };
    expect(isStale(stale, now)).toBe(true);
  });

  it('returns true when the selection is far older than the threshold', () => {
    const now = 1_000_000_000_000;
    const ancient = { park: 'disneyland' as const, currentRideId: 'r', timestamp: now - 24 * 60 * 60 * 1000 };
    expect(isStale(ancient, now)).toBe(true);
  });
});
