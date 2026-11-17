import {
  buildRecommendations,
  fallbackRecs,
  findNearestRide,
  parseAndValidate,
  prepareRecommendationInputs,
  resolveBatchSize,
} from './handler';
import { assignCodes } from './buildPromptInputs';
import { RideForPrompt } from './promptInputs';
import * as parkHoursModule from './parkHours';
import * as recentReopensModule from '../recentReopens';
import * as weatherModule from '../weather';
import { Ride, ParkData, RideMetadata, HistoricalBucket } from '../types';
import * as mainHandler from '../handler';
import * as rideMetadataModule from './rideMetadata';
import * as bedrockClient from './bedrockClient';

// Mock the dependencies that hit external services so the test stays offline.
jest.mock('../handler', () => {
  const actual = jest.requireActual<typeof import('../handler')>('../handler');
  return { ...actual, fetchPark: jest.fn() };
});
jest.mock('./rideMetadata', () => {
  const actual = jest.requireActual<typeof import('./rideMetadata')>('./rideMetadata');
  return { ...actual, ensureRideMetadataLoaded: jest.fn() };
});
jest.mock('./parkHours', () => ({ getParkHours: jest.fn() }));
jest.mock('../recentReopens', () => ({ loadRecentReopens: jest.fn() }));
jest.mock('../weather', () => ({ loadWeatherLine: jest.fn() }));
jest.mock('./bedrockClient', () => {
  const actual = jest.requireActual<typeof import('./bedrockClient')>('./bedrockClient');
  return { ...actual, invokeRecommendations: jest.fn() };
});

const mockFetchPark = mainHandler.fetchPark as jest.MockedFunction<typeof mainHandler.fetchPark>;
const mockEnsureMeta = rideMetadataModule.ensureRideMetadataLoaded as jest.MockedFunction<typeof rideMetadataModule.ensureRideMetadataLoaded>;
const mockInvoke = bedrockClient.invokeRecommendations as jest.MockedFunction<typeof bedrockClient.invokeRecommendations>;
const mockHours = parkHoursModule.getParkHours as jest.MockedFunction<typeof parkHoursModule.getParkHours>;
const mockReopens = recentReopensModule.loadRecentReopens as jest.MockedFunction<typeof recentReopensModule.loadRecentReopens>;
const mockWeather = weatherModule.loadWeatherLine as jest.MockedFunction<typeof weatherModule.loadWeatherLine>;

// parseAndValidate with codes assigned the way the handler assigns them.
function pa(text: string, candidates: RideForPrompt[], batchSize?: number) {
  return parseAndValidate(text, assignCodes(candidates), candidates, batchSize);
}

// Shape the mocked Bedrock client resolves to (see bedrockClient.BedrockResult).
function bedrockOk(text: string): bedrockClient.BedrockResult {
  return { text, usage: { inputTokens: 1000, outputTokens: 200 }, stopReason: 'end_turn', elapsedMs: 1 };
}

// Standard GPS position used across tests — sits on top of 'curr' ride coords.
const USER_LAT = 33.81;
const USER_LNG = -117.92;

function meta(rideId: string, lat: number, lng: number, name = rideId): RideMetadata {
  return { rideId, parkId: 'p', name, lat, lng, source: 'manual' };
}

// Metadata map that places 'curr' at the user's GPS position so it's always
// found as nearest (the anchor; still a candidate).
function currMeta(): Map<string, RideMetadata> {
  return new Map([['curr', meta('curr', USER_LAT, USER_LNG, 'Current')]]);
}

function makeRide(id: string, name: string, currentWait: number | null, scoreValue = 0): Ride {
  return {
    id,
    name,
    land: 'Adventureland',
    status: 'OPERATING',
    currentWait,
    historicalAverage: null,
    rideStats: null,
    prediction: null,
    recentHistory: null,
    lat: null,
    lng: null,
    closedAt: null,
    // Fallback ranking is verdict-based: higher scoreValue → higher verdict tier.
    verdict: {
      verdict: scoreValue >= 5 ? 'go' : scoreValue >= 2 ? 'neutral' : 'skip',
      reasons: {
        primary: 'none', current: currentWait ?? 0, typical: null,
        todayP30: null, todayP80: null, p10: null, p90: null,
        beatableSoon: false, betterWindowWait: null, betterWindowInMin: null, star: false,
      },
    },
  };
}

function makeParkData(rides: Ride[]): ParkData {
  return {
    park: 'Disneyland',
    lastUpdated: '2026-05-22T18:00:00Z',
    rides,
  };
}

beforeEach(() => {
  mockFetchPark.mockReset();
  mockEnsureMeta.mockReset();
  mockInvoke.mockReset();
  mockHours.mockReset().mockResolvedValue(null);
  mockReopens.mockReset().mockResolvedValue(new Map());
  mockWeather.mockReset().mockResolvedValue(null);
});

describe('parseAndValidate', () => {
  const candidates = [
    { ride: makeRide('r1', 'Ride 1', 10), walkMinutes: 3, walkYards: 240 },
    { ride: makeRide('r2', 'Ride 2', 20), walkMinutes: 7, walkYards: 560 },
  ];

  it('parses a well-formed response, attaches walkMinutes, and computes arrivalWait server-side', () => {
    const text = JSON.stringify({
      recommendations: [
        // LLM emits arrivalWait: 999 — the server should ignore it and compute its own.
        { rideId: 'r1', oneLiner: 'Closest, line is short', paragraph: 'Three-minute walk.', arrivalWait: 999 },
      ],
    });
    const recs = pa(text, candidates);
    // r1 has currentWait=10, walkMinutes=3, no historical average → flat → arrivalWait=10
    // (paragraph is dropped from the output shape — see promptBuilder TODO(paragraph))
    expect(recs).toEqual([
      { rideId: 'r1', oneLiner: 'Closest, line is short', restrictionNote: null, walkMinutes: 3, walkYards: 240, arrivalWait: 10 },
    ]);
  });

  it('uses bucket slope to project arrivalWait when historical data is present', () => {
    const ha = {
      dayType: 'weekday' as const,
      buckets: [
        { offsetMinutes: 0,   timeSlot: '11:00-11:30', wait: 20, sampleCount: 20 },
        { offsetMinutes: 30,  timeSlot: '11:30-12:00', wait: 50, sampleCount: 20 },
        { offsetMinutes: 60,  timeSlot: '12:00-12:30', wait: 60, sampleCount: 20 },
        { offsetMinutes: 90,  timeSlot: '12:30-13:00', wait: 65, sampleCount: 20 },
        { offsetMinutes: 120, timeSlot: '13:00-13:30', wait: 70, sampleCount: 20 },
        { offsetMinutes: 150, timeSlot: '13:30-14:00', wait: 72, sampleCount: 20 },
      ] as [HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket],
    };
    const candidatesWithHA = [
      { ride: { ...makeRide('r1', 'Ride 1', 10), historicalAverage: ha }, walkMinutes: 6, walkYards: 480 },
      { ride: makeRide('r2', 'Ride 2', 20), walkMinutes: 7, walkYards: 560 },
    ];
    const text = JSON.stringify({
      recommendations: [{ rideId: 'r1', oneLiner: 'good pick', paragraph: 'detail' }],
    });
    const recs = pa(text, candidatesWithHA);
    // slope = (50 - 20) / 30 = 1 min/min; arrivalWait = 10 + 1 * 6 = 16
    expect(recs![0].arrivalWait).toBe(16);
  });

  it('strips ```json code fences if the model emits them', () => {
    const text = '```json\n{"recommendations":[{"rideId":"r1","oneLiner":"a","paragraph":"b"}]}\n```';
    const recs = pa(text, candidates);
    expect(recs).toHaveLength(1);
  });

  it('returns null on malformed JSON', () => {
    expect(pa('not json', candidates)).toBeNull();
  });

  it('returns null when the root is not an object', () => {
    expect(pa('"a string"', candidates)).toBeNull();
  });

  it('returns null when `recommendations` is not an array', () => {
    expect(pa('{"recommendations":"oops"}', candidates)).toBeNull();
  });

  it('drops entries with missing or non-string fields', () => {
    const text = JSON.stringify({
      recommendations: [
        { rideId: 'r1', oneLiner: 'ok', paragraph: 'ok' },
        { rideId: 'r2', oneLiner: 42, paragraph: 'oops' },
        { oneLiner: 'no ride id', paragraph: 'oops' },
      ],
    });
    const recs = pa(text, candidates);
    expect(recs).toHaveLength(1);
    expect(recs![0].rideId).toBe('r1');
  });

  it('drops entries whose rideId is not in the candidate set', () => {
    const text = JSON.stringify({
      recommendations: [
        { rideId: 'unknown-id', oneLiner: 'hallucinated', paragraph: 'made up' },
        { rideId: 'r2', oneLiner: 'real', paragraph: 'fine' },
      ],
    });
    const recs = pa(text, candidates);
    expect(recs).toHaveLength(1);
    expect(recs![0].rideId).toBe('r2');
  });

  const many = Array.from({ length: 15 }, (_, i) =>
    ({ ride: makeRide(`id-${i}`, `Ride ${i}`, 10), walkMinutes: i, walkYards: i * 80 }));
  const manyText = JSON.stringify({
    recommendations: many.map(c => ({ rideId: c.ride.id, oneLiner: 'a', paragraph: 'b' })),
  });

  it('caps the list at the batch size (5)', () => {
    expect(pa(manyText, many)).toHaveLength(5);
  });

  it('caps the list at a custom batch size when provided', () => {
    expect(pa(manyText, many, 8)).toHaveLength(8);
    expect(pa(manyText, many, 2)).toHaveLength(2);
  });

  describe('ride codes', () => {
    // Codes go nearest-first: r1 Big Thunder (walk 2), r2 Peter Pan's (4), r3 Space (12).
    const pool: RideForPrompt[] = [
      { ride: makeRide('uuid-space', 'Space Mountain', 40), walkMinutes: 12, walkYards: 900 },
      { ride: makeRide('uuid-btmrr', 'Big Thunder Mountain Railroad', 30), walkMinutes: 2, walkYards: 150 },
      { ride: makeRide('uuid-pan', "Peter Pan's Flight", 25), walkMinutes: 4, walkYards: 300 },
    ];
    const run = (ids: string[]) => pa(JSON.stringify({
      recommendations: ids.map(rideId => ({ rideId, oneLiner: 'x', restrictionNote: null })),
    }), pool, 8)!.map(r => r.rideId);

    it('maps code plus name to the UUID', () => {
      expect(run(['r1 Big Thunder Mountain Railroad', 'r3 Space Mountain'])).toEqual(['uuid-btmrr', 'uuid-space']);
    });

    it('tolerates case, punctuation, spacing, and diacritics in the name', () => {
      expect(run(['R2  peter pans flight'])).toEqual(['uuid-pan']);
      expect(run(['r2 Peter Pan\u2019s Flight'])).toEqual(['uuid-pan']);
      expect(run(['r3: SPACE MOUNTAIN.'])).toEqual(['uuid-space']);
      expect(run(['r1 Big Thunder Mountain Railróad'])).toEqual(['uuid-btmrr']);
    });

    it('accepts a bare code', () => {
      expect(run(['r2'])).toEqual(['uuid-pan']);
    });

    it('accepts a bare UUID that is in the pool (uuid idStyle)', () => {
      expect(run(['uuid-space', 'uuid-pan'])).toEqual(['uuid-space', 'uuid-pan']);
    });

    it('drops an unknown code and keeps the rest', () => {
      expect(run(['r9 Matterhorn Bobsleds', 'r1 Big Thunder Mountain Railroad'])).toEqual(['uuid-btmrr']);
    });

    it('drops a code whose name belongs to another ride', () => {
      expect(run(['r1 Space Mountain', 'r3 Space Mountain'])).toEqual(['uuid-space']);
    });

    it('drops a UUID that is not in the pool', () => {
      expect(run(['uuid-not-here'])).toEqual([]);
    });

    it('drops duplicates of the same ride, however it is referenced', () => {
      expect(run(['r1 Big Thunder Mountain Railroad', 'r1', 'uuid-btmrr', 'r2'])).toEqual(['uuid-btmrr', 'uuid-pan']);
    });

    it('returns the UUID, never the code, in the response', () => {
      const recs = pa(JSON.stringify({ recommendations: [{ rideId: 'r3 Space Mountain', oneLiner: 'x' }] }), pool)!;
      expect(recs[0]).toMatchObject({ rideId: 'uuid-space', walkMinutes: 12, walkYards: 900 });
    });
  });
});

describe('fallbackRecs', () => {
  it('returns top picks by score descending', () => {
    const candidates = [
      { ride: makeRide('low', 'Low', 60, -2), walkMinutes: 5, walkYards: 400 },
      { ride: makeRide('high', 'High', 5, 5), walkMinutes: 3, walkYards: 240 },
      { ride: makeRide('mid', 'Mid', 30, 1), walkMinutes: 4, walkYards: 320 },
    ];
    const recs = fallbackRecs(candidates);
    expect(recs.map(r => r.rideId)).toEqual(['high', 'mid', 'low']);
    for (const r of recs) {
      expect(r.oneLiner).toBe('Recommended based on current waits.');
    }
  });

  it('caps at the batch size (5) even with more candidates', () => {
    const candidates = Array.from({ length: 15 }, (_, i) =>
      ({ ride: makeRide(`r${i}`, `R${i}`, 10, i), walkMinutes: i, walkYards: i * 80 })
    );
    expect(fallbackRecs(candidates)).toHaveLength(5);
  });

  it('caps at a custom batch size when provided', () => {
    const candidates = Array.from({ length: 15 }, (_, i) =>
      ({ ride: makeRide(`r${i}`, `R${i}`, 10, i), walkMinutes: i, walkYards: i * 80 })
    );
    expect(fallbackRecs(candidates, 8)).toHaveLength(8);
    expect(fallbackRecs(candidates, 3)).toHaveLength(3);
  });

  it('returns min(batchSize, candidates) entries on an all-skip pool', () => {
    const allSkip = Array.from({ length: 4 }, (_, i) =>
      ({ ride: makeRide(`s${i}`, `S${i}`, 60, 0), walkMinutes: i + 1, walkYards: 80 }));
    expect(allSkip.every(c => c.ride.verdict?.verdict === 'skip')).toBe(true);
    expect(fallbackRecs(allSkip, 6)).toHaveLength(4);
    expect(fallbackRecs(allSkip, 2)).toHaveLength(2);
    expect(fallbackRecs(allSkip.slice(0, 1), 6)).toHaveLength(1);
  });

  it('handles candidates without a verdict (treats as neutral)', () => {
    const ride: Ride = { ...makeRide('a', 'A', 10), verdict: null };
    const recs = fallbackRecs([{ ride, walkMinutes: 3, walkYards: 240 }]);
    expect(recs).toHaveLength(1);
    expect(recs[0].rideId).toBe('a');
  });
});

describe('findNearestRide', () => {
  const parkRides = [
    makeRide('close', 'Close', 10),
    makeRide('far', 'Far', 20),
    makeRide('noloc', 'No Coords', 5),
  ];

  it('returns the ride whose metadata coords are closest to the user', () => {
    const map = new Map<string, RideMetadata>([
      ['close', meta('close', 33.810, -117.920)],
      ['far',   meta('far',   33.820, -117.910)],
      ['noloc', { rideId: 'noloc', parkId: 'p', name: 'No Coords', lat: null, lng: null, source: 'manual' }],
    ]);
    const result = findNearestRide(33.810, -117.920, map, parkRides);
    expect(result?.id).toBe('close');
  });

  it('skips rides with null coords', () => {
    const map = new Map<string, RideMetadata>([
      ['noloc', { rideId: 'noloc', parkId: 'p', name: 'No Coords', lat: null, lng: null, source: 'manual' }],
      ['close', meta('close', 33.810, -117.920)],
    ]);
    const result = findNearestRide(33.810, -117.920, map, parkRides);
    expect(result?.id).toBe('close');
  });

  it('skips rides not in the park ride list', () => {
    const map = new Map<string, RideMetadata>([
      ['other-park-ride', meta('other-park-ride', 33.810, -117.920)],
      ['far', meta('far', 33.820, -117.910)],
    ]);
    const result = findNearestRide(33.810, -117.920, map, parkRides);
    expect(result?.id).toBe('far');
  });

  it('returns null when no ride has coordinates', () => {
    const map = new Map<string, RideMetadata>([
      ['noloc', { rideId: 'noloc', parkId: 'p', name: 'No Coords', lat: null, lng: null, source: 'manual' }],
    ]);
    expect(findNearestRide(33.810, -117.920, map, parkRides)).toBeNull();
  });

  it('returns null when the metadata map is empty', () => {
    expect(findNearestRide(33.810, -117.920, new Map(), parkRides)).toBeNull();
  });
});

describe('buildRecommendations — happy path', () => {
  it('returns LLM-picked recs when Bedrock succeeds', async () => {
    const rides = [
      makeRide('curr', 'Current Ride', null),
      makeRide('a', 'Ride A', 20, 3),
      makeRide('b', 'Ride B', 10, 5),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(new Map([
      ['curr', meta('curr', USER_LAT, USER_LNG, 'Current Ride')],
      ['a',    meta('a',    33.812, -117.92,  'A')],
      ['b',    meta('b',    33.811, -117.918, 'B')],
    ]));
    mockInvoke.mockResolvedValue(bedrockOk(JSON.stringify({
      recommendations: [
        { rideId: 'b', oneLiner: 'Top pick', paragraph: 'Big reasoning here.' },
        { rideId: 'a', oneLiner: 'Solid', paragraph: 'Reasonable.' },
      ],
    })));

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });

    expect(res.degraded).toBe(false);
    expect(res.recommendations).toHaveLength(2);
    expect(res.recommendations[0].rideId).toBe('b');
    expect(res.recommendations[0].oneLiner).toBe('Top pick');
    expect(res.currentRide.id).toBe('curr');
    expect(res.currentRide.lat).toBe(USER_LAT);
    expect(res.lastUpdated).toBe('2026-05-22T18:00:00Z');
  });

  it('always requests fresh wait-time data from fetchPark, not the passive cache', async () => {
    const rides = [makeRide('curr', 'Current Ride', null)];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(currMeta());
    mockInvoke.mockResolvedValue(bedrockOk(JSON.stringify({ recommendations: [] })));

    await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });

    expect(mockFetchPark).toHaveBeenCalledWith('disneyland', undefined, null, null, true);
  });

  it('keeps the nearest ride as a candidate and marks it as the anchor', async () => {
    const rides = [
      makeRide('curr', 'Current', 15, 5),
      makeRide('a', 'A', 10, 5),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(new Map([
      ['curr', meta('curr', USER_LAT, USER_LNG, 'Current')],
      ['a',    meta('a',    33.812, -117.92,  'A')],
    ]));
    mockInvoke.mockResolvedValue(bedrockOk(JSON.stringify({
      recommendations: [
        { rideId: 'r1 Current', oneLiner: 'Right here', restrictionNote: null },
        { rideId: 'r2 A', oneLiner: 'ok', restrictionNote: null },
      ],
    })));

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    expect(res.currentRide.id).toBe('curr');
    expect(res.recommendations.map(r => r.rideId)).toEqual(['curr', 'a']);

    const inputs = await prepareRecommendationInputs({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    expect(inputs.candidates.map(c => c.ride.id)).toContain('curr');
    const anchor = inputs.lines.find(l => l.rideId === 'curr')!;
    expect(anchor.isAnchor).toBe(true);
    expect(anchor.code).toBe('r1');
    expect(inputs.lines.filter(l => l.isAnchor)).toHaveLength(1);
    expect(inputs.requestContext.anchor).toEqual({ code: 'r1', name: 'Current' });
  });

  it('keeps skip-verdict rides in the candidate pool', async () => {
    const rides = [
      makeRide('curr', 'Current', 15, 5),
      makeRide('busy', 'Busy', 90, 0), // verdict skip
    ];
    expect(rides[1].verdict?.verdict).toBe('skip');
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(currMeta());
    mockInvoke.mockResolvedValue(bedrockOk(JSON.stringify({
      recommendations: [{ rideId: 'busy', oneLiner: 'Everything is busy today' }],
    })));

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    expect(res.recommendations.map(r => r.rideId)).toEqual(['busy']);
    const inputs = await prepareRecommendationInputs({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    expect(inputs.lines.find(l => l.rideId === 'busy')?.verdict).toBe('skip');
  });

  it('removes rides the guest cannot walk to before close', async () => {
    // 10:50 PM PDT, park closes 11:00 PM → 10 minutes left.
    const at = new Date('2026-05-23T05:50:00Z');
    const rides = [
      makeRide('curr', 'Current', 15, 5),
      makeRide('near', 'Near', 20, 5),
      makeRide('far', 'Far', 5, 5),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(new Map([
      ['curr', meta('curr', USER_LAT, USER_LNG, 'Current')],
      ['near', meta('near', 33.811, -117.92, 'Near')],
      ['far',  { ...meta('far', 33.811, -117.92, 'Far'), walkPenaltyMinutes: 15 }],
    ]));
    mockHours.mockResolvedValue({ open: '08:00', close: '23:00' });
    mockInvoke.mockRejectedValue(new Error('Bedrock down'));

    const inputs = await prepareRecommendationInputs({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG, at });
    expect(inputs.requestContext.minutesUntilClose).toBe(10);
    expect(inputs.requestContext.closesAt).toBe('11:00 PM');
    expect(inputs.candidates.map(c => c.ride.id).sort()).toEqual(['curr', 'near']);

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG, at });
    expect(res.recommendations.map(r => r.rideId)).not.toContain('far');
  });

  it('keeps every operating ride when park hours are unknown', async () => {
    const rides = [
      makeRide('curr', 'Current', 15, 5),
      makeRide('far', 'Far', 5, 5),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(new Map([
      ['curr', meta('curr', USER_LAT, USER_LNG, 'Current')],
      ['far',  { ...meta('far', 33.811, -117.92, 'Far'), walkPenaltyMinutes: 60 }],
    ]));
    const inputs = await prepareRecommendationInputs({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    expect(inputs.requestContext.minutesUntilClose).toBeNull();
    expect(inputs.candidates).toHaveLength(2);
  });

  it('threads reopens, weather, and wanted rides onto the lines and context', async () => {
    const rides = [
      makeRide('curr', 'Current', 15, 5),
      makeRide('a', 'A', 10, 5),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(currMeta());
    mockReopens.mockResolvedValue(new Map([['a', 12]]));
    mockWeather.mockResolvedValue('71F, feels like 71, clear');
    const inputs = await prepareRecommendationInputs({
      park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG, count: 6,
      persona: { tripDuration: null, youngestAge: null, ridePreferences: [], mustDoRideIds: ['a'], accessibilityNeeds: [] },
    });
    const a = inputs.lines.find(l => l.rideId === 'a')!;
    expect(a.reopenedMinAgo).toBe(12);
    expect(a.wanted).toBe(true);
    expect(inputs.lines.find(l => l.rideId === 'curr')!.wanted).toBe(false);
    expect(inputs.requestContext.weather).toBe('71F, feels like 71, clear');
    expect(inputs.requestContext.batchSize).toBe(6);
  });

  it('serves recs when every side load fails', async () => {
    const rides = [makeRide('curr', 'Current', 15, 5), makeRide('a', 'A', 10, 5)];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(currMeta());
    mockHours.mockRejectedValue(new Error('schedule down'));
    mockReopens.mockRejectedValue(new Error('firestore down'));
    mockWeather.mockRejectedValue(new Error('firestore down'));
    mockInvoke.mockResolvedValue(bedrockOk(JSON.stringify({ recommendations: [{ rideId: 'r2 A', oneLiner: 'ok' }] })));
    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    expect(res.degraded).toBe(false);
    expect(res.recommendations.map(r => r.rideId)).toEqual(['a']);
  });
});

describe('buildRecommendations — degraded paths', () => {
  it('falls back to deterministic recs when Bedrock throws', async () => {
    const rides = [
      makeRide('curr', 'Current', null),
      makeRide('a', 'A', 10, 3),
      makeRide('b', 'B', 20, 5),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(currMeta());
    mockInvoke.mockRejectedValue(new Error('Bedrock down'));

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });

    expect(res.degraded).toBe(true);
    // verdict-tier order: b(go), a(neutral), then curr (skip). The nearest
    // ride is a candidate now (spec 6.10) and skip verdicts stay in (6.11).
    expect(res.recommendations.map(r => r.rideId)).toEqual(['b', 'a', 'curr']);
    expect(res.recommendations[0].oneLiner).toBe('Recommended based on current waits.');
  });

  it('falls back when Bedrock returns malformed JSON', async () => {
    const rides = [
      makeRide('curr', 'Current', null),
      makeRide('a', 'A', 10, 3),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(currMeta());
    mockInvoke.mockResolvedValue(bedrockOk('not json at all'));

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    expect(res.degraded).toBe(true);
    // 'a' plus the anchor 'curr'
    expect(res.recommendations).toHaveLength(2);
  });

  it('falls back with at least one entry when the whole pool is skip', async () => {
    const rides = [
      makeRide('curr', 'Current', 60, 0),
      makeRide('a', 'A', 70, 0),
      makeRide('b', 'B', 80, 0),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(currMeta());
    mockInvoke.mockResolvedValue(bedrockOk(JSON.stringify({ recommendations: [] })));
    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG, count: 6 });
    expect(res.degraded).toBe(true);
    expect(res.recommendations).toHaveLength(3);
  });

  it('returns an empty non-degraded response when there are zero operating candidates', async () => {
    const rides = [
      { ...makeRide('curr', 'Current', null), status: 'CLOSED' },
      { ...makeRide('a', 'A', null), status: 'CLOSED' },
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(new Map());

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    expect(res.degraded).toBe(false);
    expect(res.recommendations).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('still works when ride_metadata load fails (no walk distances, no crash)', async () => {
    const rides = [
      makeRide('curr', 'Current', null),
      makeRide('a', 'A', 10, 3),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockRejectedValue(new Error('Firestore down'));
    mockInvoke.mockResolvedValue(bedrockOk(JSON.stringify({
      recommendations: [{ rideId: 'a', oneLiner: 'ok', paragraph: 'ok' }],
    })));

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    expect(res.degraded).toBe(false);
    expect(res.recommendations[0].walkMinutes).toBeNull();
  });
});

describe('buildRecommendations — persona injection', () => {
  function setupHappyPark() {
    const rides = [
      makeRide('curr', 'Current', null),
      makeRide('a', 'Ride A', 10, 3),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(currMeta());
    mockInvoke.mockResolvedValue(bedrockOk(JSON.stringify({
      recommendations: [{ rideId: 'a', oneLiner: 'ok', paragraph: 'ok' }],
    })));
  }

  it('uses the default persona when no persona is provided', async () => {
    setupHappyPark();
    await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    const systemPrompt = ([] as string[]).concat(mockInvoke.mock.calls[0][0]).join('\n');
    expect(systemPrompt).toContain('Club 32 Generic Guest');
  });

  it('uses the default persona when persona is null', async () => {
    setupHappyPark();
    await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG, persona: null });
    const systemPrompt = ([] as string[]).concat(mockInvoke.mock.calls[0][0]).join('\n');
    expect(systemPrompt).toContain('Club 32 Generic Guest');
  });

  it('threads custom persona signals into the system prompt', async () => {
    setupHappyPark();
    await buildRecommendations({
      park: 'disneyland',
      userLat: USER_LAT,
      userLng: USER_LNG,
      persona: {
        tripDuration: '1-day',
        youngestAge: 4,
        ridePreferences: ['classics', 'first-time'],
        mustDoRideIds: [],
        accessibilityNeeds: ['stroller'],
      },
    });
    const systemPrompt = ([] as string[]).concat(mockInvoke.mock.calls[0][0]).join('\n');
    expect(systemPrompt).toContain('Single-day');
    expect(systemPrompt).toContain('age 4');
    expect(systemPrompt).toContain('first visit');
    expect(systemPrompt).toContain('classic Disney');
    expect(systemPrompt).toContain('stroller');
    expect(systemPrompt).not.toContain('Club 32 Generic Guest');
  });

  it('falls back to the default persona when every field is empty', async () => {
    setupHappyPark();
    await buildRecommendations({
      park: 'disneyland',
      userLat: USER_LAT,
      userLng: USER_LNG,
      persona: {
        tripDuration: null,
        youngestAge: null,
        ridePreferences: [],
        mustDoRideIds: [],
        accessibilityNeeds: [],
      },
    });
    const systemPrompt = ([] as string[]).concat(mockInvoke.mock.calls[0][0]).join('\n');
    expect(systemPrompt).toContain('Club 32 Generic Guest');
  });
});

describe('resolveBatchSize', () => {
  it('defaults to 5 when no count is given', () => {
    expect(resolveBatchSize()).toBe(5);
    expect(resolveBatchSize(undefined)).toBe(5);
  });

  it('passes through counts within 1..8', () => {
    expect(resolveBatchSize(1)).toBe(1);
    expect(resolveBatchSize(8)).toBe(8);
  });

  it('clamps out-of-range counts to [1, 8]', () => {
    expect(resolveBatchSize(20)).toBe(8);
    expect(resolveBatchSize(0)).toBe(1);
  });
});

describe('buildRecommendations — count', () => {
  function setupBigPark() {
    const rides = [
      makeRide('curr', 'Current', null),
      ...Array.from({ length: 12 }, (_, i) => makeRide(`r${i}`, `R${i}`, 10, 5)),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(currMeta());
  }

  it('asks the LLM for 5 by default', async () => {
    setupBigPark();
    mockInvoke.mockResolvedValue(bedrockOk(JSON.stringify({ recommendations: [] })));
    await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    const [, userMessage] = mockInvoke.mock.calls[0];
    expect(userMessage).toContain('up to 5 recommendations');
  });

  it('asks the LLM for the requested count and returns that many', async () => {
    setupBigPark();
    mockInvoke.mockResolvedValue(bedrockOk(JSON.stringify({
      recommendations: Array.from({ length: 12 }, (_, i) => ({ rideId: `r${i}`, oneLiner: 'ok' })),
    })));
    const res = await buildRecommendations({
      park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG, count: 8,
    });
    const [, userMessage] = mockInvoke.mock.calls[0];
    expect(userMessage).toContain('up to 8 recommendations');
    expect(res.recommendations).toHaveLength(8);
    expect(res.hasMore).toBe(true);
  });

  it('applies the requested count to the degraded fallback too', async () => {
    setupBigPark();
    mockInvoke.mockRejectedValue(new Error('Bedrock down'));
    const res = await buildRecommendations({
      park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG, count: 7,
    });
    expect(res.degraded).toBe(true);
    expect(res.recommendations).toHaveLength(7);
  });
});

describe('cleanCopy', () => {
  const { cleanCopy } = jest.requireActual<typeof import('./handler')>('./handler');
  it('turns em and en dashes into a comma and exclamation marks into a period', () => {
    expect(cleanCopy('Half its usual line—go now!')).toBe('Half its usual line, go now.');
    expect(cleanCopy('Short walk – easy pick')).toBe('Short walk, easy pick');
  });
  it('leaves clean copy alone', () => {
    expect(cleanCopy('Lines are long everywhere today, so this is the least bad move.')).toBe('Lines are long everywhere today, so this is the least bad move.');
  });
});
