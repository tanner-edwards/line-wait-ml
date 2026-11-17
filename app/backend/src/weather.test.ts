import { _clearWeatherCache, formatWeatherLine, loadWeatherLine, weatherWord } from './weather';
import * as firestoreClient from './firestoreClient';

jest.mock('./firestoreClient');

const mockedGetFirestore = firestoreClient.getFirestore as jest.MockedFunction<typeof firestoreClient.getFirestore>;

const NOW = new Date('2026-11-14T21:30:00Z');
const ts = (minsAgo: number) => ({ toDate: () => new Date(NOW.getTime() - minsAgo * 60_000) });

function makeSnap(docs: object[]) {
  return { forEach: (cb: (doc: { data: () => object }) => void) => docs.forEach(d => cb({ data: () => d })) };
}

function buildMockDb(get: jest.Mock) {
  const limit = jest.fn().mockReturnValue({ get });
  const orderBy = jest.fn().mockReturnValue({ limit });
  const collection = jest.fn().mockReturnValue({ orderBy });
  return { db: { collection }, collection, orderBy, limit, get };
}

beforeEach(() => {
  _clearWeatherCache();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('weatherWord', () => {
  it.each([
    [0, 'clear'], [1, 'partly cloudy'], [2, 'partly cloudy'], [3, 'cloudy'],
    [45, 'fog'], [48, 'fog'], [51, 'rain'], [67, 'rain'], [71, 'snow'], [77, 'snow'],
    [80, 'showers'], [82, 'showers'], [95, 'thunderstorms'], [99, 'thunderstorms'],
    [4, 'conditions unknown'], [50, 'conditions unknown'], [68, 'conditions unknown'],
    [90, 'conditions unknown'], [null, 'conditions unknown'],
  ])('WMO %p → %s', (code, word) => {
    expect(weatherWord(code as number | null)).toBe(word);
  });
});

describe('formatWeatherLine', () => {
  it('rounds temperatures', () => {
    expect(formatWeatherLine({ temperature_f: 87.6, feels_like_f: 91.5, weather_code: 0 }))
      .toBe('88F, feels like 92, clear');
  });
  it('omits feels-like when missing and returns null without a temperature', () => {
    expect(formatWeatherLine({ temperature_f: 70, feels_like_f: null, weather_code: 61 })).toBe('70F, rain');
    expect(formatWeatherLine({ temperature_f: null, feels_like_f: 70, weather_code: 0 })).toBeNull();
  });
});

describe('loadWeatherLine', () => {
  it('reads the newest DLR snapshot and formats it', async () => {
    const m = buildMockDb(jest.fn().mockResolvedValue(makeSnap([
      { timestamp_utc: ts(5), temperature_f: 71.2, feels_like_f: 70.8, weather_code: 2 },
    ])));
    mockedGetFirestore.mockReturnValue(m.db as any);
    expect(await loadWeatherLine('disneyland', NOW)).toBe('71F, feels like 71, partly cloudy');
    expect(m.collection).toHaveBeenCalledWith('weather_snapshots');
    expect(m.orderBy).toHaveBeenCalledWith('timestamp_utc', 'desc');
    expect(m.limit).toHaveBeenCalledWith(1);
  });

  it('caches per resort, so both DLR parks share one read', async () => {
    const m = buildMockDb(jest.fn().mockResolvedValue(makeSnap([
      { timestamp_utc: ts(5), temperature_f: 71, feels_like_f: 71, weather_code: 0 },
    ])));
    mockedGetFirestore.mockReturnValue(m.db as any);
    await loadWeatherLine('disneyland', NOW);
    expect(await loadWeatherLine('california-adventure', NOW)).toBe('71F, feels like 71, clear');
    expect(m.get).toHaveBeenCalledTimes(1);
  });

  it('returns null for an empty collection or a stale snapshot', async () => {
    mockedGetFirestore.mockReturnValue(buildMockDb(jest.fn().mockResolvedValue(makeSnap([]))).db as any);
    expect(await loadWeatherLine('disneyland', NOW)).toBeNull();
    _clearWeatherCache();
    mockedGetFirestore.mockReturnValue(buildMockDb(jest.fn().mockResolvedValue(makeSnap([
      { timestamp_utc: ts(180), temperature_f: 71, feels_like_f: 71, weather_code: 0 },
    ]))).db as any);
    expect(await loadWeatherLine('disneyland', NOW)).toBeNull();
  });

  it('returns null and does not cache when the read fails', async () => {
    const get = jest.fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(makeSnap([{ timestamp_utc: ts(1), temperature_f: 60, feels_like_f: 58, weather_code: 3 }]));
    mockedGetFirestore.mockReturnValue(buildMockDb(get).db as any);
    expect(await loadWeatherLine('disneyland', NOW)).toBeNull();
    expect(await loadWeatherLine('disneyland', NOW)).toBe('60F, feels like 58, cloudy');
  });

  it('returns null when Firestore cannot initialize', async () => {
    mockedGetFirestore.mockImplementation(() => { throw new Error('no creds'); });
    expect(await loadWeatherLine('disneyland', NOW)).toBeNull();
  });
});
