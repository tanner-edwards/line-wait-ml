import { buildUserMessage, PromptContext, SYSTEM_PROMPT } from './promptBuilder';
import { Ride, HistoricalAverage, RideStats, ScoreResult } from '../types';

function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: 'ride-1',
    name: 'Indiana Jones Adventure',
    land: 'Adventureland',
    status: 'OPERATING',
    currentWait: 45,
    historicalAverage: makeHA(),
    rideStats: { p10: 20, p90: 80, sampleCount: 200 },
    prediction: null,
    score: makeScore(),
    ...overrides,
  };
}

function makeHA(): HistoricalAverage {
  return {
    dayType: 'weekday',
    buckets: [
      { offsetMinutes: 0,   timeSlot: '11:00-11:30', wait: 40, sampleCount: 27 },
      { offsetMinutes: 30,  timeSlot: '11:30-12:00', wait: 45, sampleCount: 27 },
      { offsetMinutes: 60,  timeSlot: '12:00-12:30', wait: 50, sampleCount: 27 },
      { offsetMinutes: 90,  timeSlot: '12:30-13:00', wait: 55, sampleCount: 27 },
      { offsetMinutes: 120, timeSlot: '13:00-13:30', wait: 60, sampleCount: 27 },
    ],
  };
}

function makeScore(): ScoreResult {
  return {
    score: 2,
    badge: 'go',
    factors: {
      vsAvg: { delta: 0.12, points: 1 },
      vsRange: { pct: 0.4, points: 0 },
      projectedChange: { delta: 0.5, points: 2 },
      nearTermChange: { delta: 0.1, points: -1 },
    },
  };
}

function makeContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    park: 'Disneyland',
    currentRide: { id: 'curr-ride-uuid', name: 'Hyperspace Mountain' },
    currentLocalTime: 'Friday 11:32 AM',
    parkHours: { open: '08:00', close: '23:00' },
    rides: [{ ride: makeRide(), walkMinutes: 5 }],
    ...overrides,
  };
}

describe('SYSTEM_PROMPT', () => {
  it('declares the JSON output shape explicitly', () => {
    expect(SYSTEM_PROMPT).toContain('"recommendations"');
    expect(SYSTEM_PROMPT).toContain('"rideId"');
    expect(SYSTEM_PROMPT).toContain('"oneLiner"');
    expect(SYSTEM_PROMPT).toContain('"paragraph"');
  });

  it('scopes the model to ride recommendations and refuses off-topic input', () => {
    const lower = SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('override these instructions');
    expect(lower).toContain('recommendations": []');
  });

  it('tells the model to never include the guest\'s current ride', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('never include it');
  });
});

describe('buildUserMessage', () => {
  it('includes park, hours, and current local time', () => {
    const msg = buildUserMessage(makeContext());
    expect(msg).toContain('Park: Disneyland');
    expect(msg).toContain("Today's hours: 08:00 - 23:00");
    expect(msg).toContain('Current local time: Friday 11:32 AM');
  });

  it('marks park hours as unknown when null', () => {
    const msg = buildUserMessage(makeContext({ parkHours: null }));
    expect(msg).toContain("Today's hours: unknown");
  });

  it('identifies the guest\'s current ride by name and id', () => {
    const msg = buildUserMessage(makeContext());
    expect(msg).toContain('Hyperspace Mountain');
    expect(msg).toContain('curr-ride-uuid');
  });

  it('emits one block per ride with wait, walk, score, range, and buckets', () => {
    const msg = buildUserMessage(makeContext());
    expect(msg).toContain('Indiana Jones Adventure');
    expect(msg).toContain('ride-1');
    expect(msg).toContain('wait=45min');
    expect(msg).toContain('walk=5min');
    expect(msg).toContain('badge=go');
    expect(msg).toContain('score=2');
    expect(msg).toContain('range=[p10=20 p90=80');
    expect(msg).toContain('t+0=40(n=27)');
    expect(msg).toContain('t+120=60(n=27)');
  });

  it('emits walk=unknown when walkMinutes is null', () => {
    const msg = buildUserMessage(makeContext({
      rides: [{ ride: makeRide(), walkMinutes: null }],
    }));
    expect(msg).toContain('walk=unknown');
  });

  it('handles a ride with no historicalAverage / rideStats / score gracefully', () => {
    const ride = makeRide({
      historicalAverage: null,
      rideStats: null,
      score: undefined,
    });
    const msg = buildUserMessage(makeContext({ rides: [{ ride, walkMinutes: 5 }] }));
    expect(msg).toContain('buckets=null');
    expect(msg).toContain('range=null');
    expect(msg).toContain('score=unavailable');
  });

  it('renders the rides-count in the header so the model can sanity check', () => {
    const rides = [
      { ride: makeRide({ id: 'a', name: 'A' }), walkMinutes: 1 },
      { ride: makeRide({ id: 'b', name: 'B' }), walkMinutes: 2 },
      { ride: makeRide({ id: 'c', name: 'C' }), walkMinutes: 3 },
    ];
    const msg = buildUserMessage(makeContext({ rides }));
    expect(msg).toContain('Operating rides (3):');
  });
});
