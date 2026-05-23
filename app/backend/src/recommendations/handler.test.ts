import {
  buildRecommendations,
  fallbackRecs,
  parseAndValidate,
} from './handler';
import { Ride, ParkData } from '../types';
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
    score: {
      score: scoreValue,
      badge: scoreValue >= 2 ? 'go' : null,
      factors: {
        vsAvg: null,
        vsRange: null,
        projectedChange: null,
        nearTermChange: null,
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
    { ride: makeRide('r1', 'Ride 1', 10), walkMinutes: 3 },
    { ride: makeRide('r2', 'Ride 2', 20), walkMinutes: 7 },
  ];

  it('parses a well-formed response and attaches walkMinutes', () => {
    const text = JSON.stringify({
      recommendations: [
        { rideId: 'r1', oneLiner: 'Closest, line is short', paragraph: 'Three-minute walk.' },
      ],
    });
    const recs = parseAndValidate(text, candidates);
    expect(recs).toEqual([
      { rideId: 'r1', oneLiner: 'Closest, line is short', paragraph: 'Three-minute walk.', walkMinutes: 3 },
    ]);
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

  it('caps the list at 10 entries', () => {
    const recs = parseAndValidate(JSON.stringify({
      recommendations: Array.from({ length: 15 }, () => ({
        rideId: 'r1', oneLiner: 'a', paragraph: 'b',
      })),
    }), candidates);
    expect(recs).toHaveLength(10);
  });
});

describe('fallbackRecs', () => {
  it('returns top-10 by score descending', () => {
    const candidates = [
      { ride: makeRide('low', 'Low', 60, -2), walkMinutes: 5 },
      { ride: makeRide('high', 'High', 5, 5), walkMinutes: 3 },
      { ride: makeRide('mid', 'Mid', 30, 1), walkMinutes: 4 },
    ];
    const recs = fallbackRecs(candidates);
    expect(recs.map(r => r.rideId)).toEqual(['high', 'mid', 'low']);
    for (const r of recs) {
      expect(r.oneLiner).toBe('Recommended based on current waits.');
    }
  });

  it('caps at 10 even with more candidates', () => {
    const candidates = Array.from({ length: 15 }, (_, i) =>
      ({ ride: makeRide(`r${i}`, `R${i}`, 10, i), walkMinutes: i })
    );
    expect(fallbackRecs(candidates)).toHaveLength(10);
  });

  it('handles candidates without a score (treats as 0)', () => {
    const ride: Ride = { ...makeRide('a', 'A', 10), score: undefined };
    const recs = fallbackRecs([{ ride, walkMinutes: 3 }]);
    expect(recs).toHaveLength(1);
    expect(recs[0].rideId).toBe('a');
  });
});

describe('buildRecommendations — happy path', () => {
  it('returns LLM-picked recs when Bedrock succeeds', async () => {
    const rides = [
      makeRide('curr', 'Current Ride', null), // user is here
      makeRide('a', 'Ride A', 20, 3),
      makeRide('b', 'Ride B', 10, 5),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(new Map([
      ['curr', { rideId: 'curr', parkId: 'p', name: 'Current Ride', lat: 33.81, lng: -117.92, source: 'manual' }],
      ['a', { rideId: 'a', parkId: 'p', name: 'A', lat: 33.812, lng: -117.92, source: 'manual' }],
      ['b', { rideId: 'b', parkId: 'p', name: 'B', lat: 33.811, lng: -117.918, source: 'manual' }],
    ]));
    mockInvoke.mockResolvedValue(JSON.stringify({
      recommendations: [
        { rideId: 'b', oneLiner: 'Top pick', paragraph: 'Big reasoning here.' },
        { rideId: 'a', oneLiner: 'Solid', paragraph: 'Reasonable.' },
      ],
    }));

    const res = await buildRecommendations({ park: 'disneyland', currentRideId: 'curr' });

    expect(res.degraded).toBe(false);
    expect(res.recommendations).toHaveLength(2);
    expect(res.recommendations[0].rideId).toBe('b');
    expect(res.recommendations[0].oneLiner).toBe('Top pick');
    expect(res.currentRide.id).toBe('curr');
    expect(res.currentRide.lat).toBe(33.81);
    expect(res.lastUpdated).toBe('2026-05-22T18:00:00Z');
  });

  it('excludes the user\'s current ride from candidates even if Bedrock tries to recommend it', async () => {
    const rides = [
      makeRide('curr', 'Current', null),
      makeRide('a', 'A', 10, 5),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(new Map());
    mockInvoke.mockResolvedValue(JSON.stringify({
      recommendations: [
        { rideId: 'curr', oneLiner: 'Try me again!', paragraph: 'Bad model.' },
        { rideId: 'a', oneLiner: 'ok', paragraph: 'ok' },
      ],
    }));

    const res = await buildRecommendations({ park: 'disneyland', currentRideId: 'curr' });
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
    mockEnsureMeta.mockResolvedValue(new Map());
    mockInvoke.mockRejectedValue(new Error('Bedrock down'));

    const res = await buildRecommendations({ park: 'disneyland', currentRideId: 'curr' });

    expect(res.degraded).toBe(true);
    // top-by-score order: b(5) before a(3)
    expect(res.recommendations.map(r => r.rideId)).toEqual(['b', 'a']);
    expect(res.recommendations[0].oneLiner).toBe('Recommended based on current waits.');
  });

  it('falls back when Bedrock returns malformed JSON', async () => {
    const rides = [
      makeRide('curr', 'Current', null),
      makeRide('a', 'A', 10, 3),
    ];
    mockFetchPark.mockResolvedValue(makeParkData(rides));
    mockEnsureMeta.mockResolvedValue(new Map());
    mockInvoke.mockResolvedValue('not json at all');

    const res = await buildRecommendations({ park: 'disneyland', currentRideId: 'curr' });
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

    const res = await buildRecommendations({ park: 'disneyland', currentRideId: 'curr' });
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

    const res = await buildRecommendations({ park: 'disneyland', currentRideId: 'curr' });
    expect(res.degraded).toBe(false);
    expect(res.recommendations[0].walkMinutes).toBeNull();
  });
});
