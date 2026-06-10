import {
  buildRecommendations,
  fallbackRecs,
  findNearestRide,
  parseAndValidate,
} from './handler';
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
jest.mock('./bedrockClient', () => {
  const actual = jest.requireActual<typeof import('./bedrockClient')>('./bedrockClient');
  return { ...actual, invokeRecommendations: jest.fn() };
});

const mockFetchPark = mainHandler.fetchPark as jest.MockedFunction<typeof mainHandler.fetchPark>;
const mockEnsureMeta = rideMetadataModule.ensureRideMetadataLoaded as jest.MockedFunction<typeof rideMetadataModule.ensureRideMetadataLoaded>;
const mockInvoke = bedrockClient.invokeRecommendations as jest.MockedFunction<typeof bedrockClient.invokeRecommendations>;

// Standard GPS position used across tests — sits on top of 'curr' ride coords.
const USER_LAT = 33.81;
const USER_LNG = -117.92;

function meta(rideId: string, lat: number, lng: number, name = rideId): RideMetadata {
  return { rideId, parkId: 'p', name, lat, lng, source: 'manual' };
}

// Metadata map that places 'curr' at the user's GPS position so it's always
// found as nearest and excluded from candidates.
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
    score: {
      score: scoreValue,
      badge: scoreValue >= 2 ? 'go' : null,
      factors: {
        vsAvg: null,
        vsRange: null,
        projectedChange: null,
        nearTermChange: null,
        rapidChange: null,
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
    const recs = parseAndValidate(text, candidates);
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
    const recs = parseAndValidate(text, candidatesWithHA);
    // slope = (50 - 20) / 30 = 1 min/min; arrivalWait = 10 + 1 * 6 = 16
    expect(recs![0].arrivalWait).toBe(16);
  });

  it('strips ```json code fences if the model emits them', () => {
    const text = '```json\n{"recommendations":[{"rideId":"r1","oneLiner":"a","paragraph":"b"}]}\n```';
    const recs = parseAndValidate(text, candidates);
    expect(recs).toHaveLength(1);
  });

  it('returns null on malformed JSON', () => {
    expect(parseAndValidate('not json', candidates)).toBeNull();
  });

  it('returns null when the root is not an object', () => {
    expect(parseAndValidate('"a string"', candidates)).toBeNull();
  });

  it('returns null when `recommendations` is not an array', () => {
    expect(parseAndValidate('{"recommendations":"oops"}', candidates)).toBeNull();
  });

  it('drops entries with missing or non-string fields', () => {
    const text = JSON.stringify({
      recommendations: [
        { rideId: 'r1', oneLiner: 'ok', paragraph: 'ok' },
        { rideId: 'r2', oneLiner: 42, paragraph: 'oops' },
        { oneLiner: 'no ride id', paragraph: 'oops' },
      ],
    });
    const recs = parseAndValidate(text, candidates);
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
    const recs = parseAndValidate(text, candidates);
    expect(recs).toHaveLength(1);
    expect(recs![0].rideId).toBe('r2');
  });

  it('caps the list at the batch size (5)', () => {
    const recs = parseAndValidate(JSON.stringify({
      recommendations: Array.from({ length: 15 }, () => ({
        rideId: 'r1', oneLiner: 'a', paragraph: 'b',
      })),
    }), candidates);
    expect(recs).toHaveLength(5);
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

  it('handles candidates without a score (treats as 0)', () => {
    const ride: Ride = { ...makeRide('a', 'A', 10), score: undefined };
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
    mockInvoke.mockResolvedValue(JSON.stringify({
      recommendations: [
        { rideId: 'b', oneLiner: 'Top pick', paragraph: 'Big reasoning here.' },
        { rideId: 'a', oneLiner: 'Solid', paragraph: 'Reasonable.' },
      ],
    }));

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });

    expect(res.degraded).toBe(false);
    expect(res.recommendations).toHaveLength(2);
    expect(res.recommendations[0].rideId).toBe('b');
    expect(res.recommendations[0].oneLiner).toBe('Top pick');
    expect(res.currentRide.id).toBe('curr');
    expect(res.currentRide.lat).toBe(USER_LAT);
    expect(res.lastUpdated).toBe('2026-05-22T18:00:00Z');
  });

  it('excludes the nearest ride from candidates even if Bedrock tries to recommend it', async () => {
    const rides = [
      makeRide('curr', 'Current', null),
      makeRide('a', 'A', 10, 5),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    // 'curr' is at USER_LAT/LNG → nearest → excluded from candidates
    mockEnsureMeta.mockResolvedValue(currMeta());
    mockInvoke.mockResolvedValue(JSON.stringify({
      recommendations: [
        { rideId: 'curr', oneLiner: 'Try me again!', paragraph: 'Bad model.' },
        { rideId: 'a', oneLiner: 'ok', paragraph: 'ok' },
      ],
    }));

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
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
    // top-by-score order: b(5) before a(3); curr excluded as nearest ride
    expect(res.recommendations.map(r => r.rideId)).toEqual(['b', 'a']);
    expect(res.recommendations[0].oneLiner).toBe('Recommended based on current waits.');
  });

  it('falls back when Bedrock returns malformed JSON', async () => {
    const rides = [
      makeRide('curr', 'Current', null),
      makeRide('a', 'A', 10, 3),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(currMeta());
    mockInvoke.mockResolvedValue('not json at all');

    const res = await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    expect(res.degraded).toBe(true);
    expect(res.recommendations).toHaveLength(1);
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
    mockInvoke.mockResolvedValue(JSON.stringify({
      recommendations: [{ rideId: 'a', oneLiner: 'ok', paragraph: 'ok' }],
    }));

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
    mockInvoke.mockResolvedValue(JSON.stringify({
      recommendations: [{ rideId: 'a', oneLiner: 'ok', paragraph: 'ok' }],
    }));
  }

  it('uses the default persona when no persona is provided', async () => {
    setupHappyPark();
    await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG });
    const [systemPrompt] = mockInvoke.mock.calls[0];
    expect(systemPrompt).toContain('Club 32 Generic Guest');
  });

  it('uses the default persona when persona is null', async () => {
    setupHappyPark();
    await buildRecommendations({ park: 'disneyland', userLat: USER_LAT, userLng: USER_LNG, persona: null });
    const [systemPrompt] = mockInvoke.mock.calls[0];
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
    const [systemPrompt] = mockInvoke.mock.calls[0];
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
    const [systemPrompt] = mockInvoke.mock.calls[0];
    expect(systemPrompt).toContain('Club 32 Generic Guest');
  });
});
