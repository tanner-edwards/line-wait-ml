import { TTLCache } from './cache';

describe('TTLCache', () => {
  let currentTime = 0;
  const fakeNow = () => currentTime;

  beforeEach(() => {
    currentTime = 1_000_000;
  });

  it('returns the value when called within TTL', () => {
    const cache = new TTLCache<string, string>(1000, fakeNow);
    cache.set('a', 'apple');

    currentTime += 500;

    expect(cache.get('a')).toBe('apple');
  });

  it('returns undefined once TTL has elapsed', () => {
    const cache = new TTLCache<string, string>(1000, fakeNow);
    cache.set('a', 'apple');

    currentTime += 1001;

    expect(cache.get('a')).toBeUndefined();
  });

  it('returns undefined for an unknown key', () => {
    const cache = new TTLCache<string, string>(1000, fakeNow);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('keeps independent TTLs per key — refreshing one does not affect the other', () => {
    const cache = new TTLCache<string, string>(1000, fakeNow);
    cache.set('a', 'apple');

    currentTime += 600;
    cache.set('b', 'banana');

    currentTime += 500; // a is now 1100ms old (expired); b is 500ms old (live)

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('banana');
  });

  it('clear() removes everything', () => {
    const cache = new TTLCache<string, string>(1000, fakeNow);
    cache.set('a', 'apple');
    cache.set('b', 'banana');

    cache.clear();

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});
