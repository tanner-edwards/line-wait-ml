import { scoreRide, ScoreResult } from './score';
import { Ride, HistoricalAverage, RideStats } from '../types';

function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: 'ride-1',
    name: 'Test Ride',
    land: 'Testland',
    status: 'OPERATING',
    currentWait: 30,
    historicalAverage: makeHA(30, 30, 30),
    rideStats: makeStats(15, 60),
    prediction: null,
    ...overrides,
  };
}

function makeHA(
  b0Wait: number | null,
  b1Wait: number | null,
  b2Wait: number | null,
  sampleCount = 50
): HistoricalAverage {
  return {
    dayType: 'weekday',
    buckets: [
      { offsetMinutes: 0,  timeSlot: '10:00-10:30', wait: b0Wait, sampleCount },
      { offsetMinutes: 30, timeSlot: '10:30-11:00', wait: b1Wait, sampleCount },
      { offsetMinutes: 60, timeSlot: '11:00-11:30', wait: b2Wait, sampleCount },
    ],
  };
}

function makeStats(p10: number, p90: number, sampleCount = 200): RideStats {
  return { p10, p90, sampleCount };
}

// --- Suppression ---

describe('suppression', () => {
  it('returns no badge when currentWait is null', () => {
    expect(scoreRide(makeRide({ currentWait: null })).badge).toBeNull();
  });

  it('returns no badge when status is CLOSED', () => {
    expect(scoreRide(makeRide({ status: 'CLOSED' })).badge).toBeNull();
  });

  it('returns no badge when historicalAverage is null', () => {
    expect(scoreRide(makeRide({ historicalAverage: null })).badge).toBeNull();
  });

  it('returns no badge when bucket0.sampleCount < 20', () => {
    expect(
      scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 30, 5) })).badge
    ).toBeNull();
  });
});

// --- Factor 1: vs. current-bucket average ---

describe('Factor 1 — vs average', () => {
  it('+2 when >25% below average', () => {
    // currentWait=20, bucket0=30: delta = -33%
    const r = scoreRide(makeRide({ currentWait: 20, historicalAverage: makeHA(30, 30, 30), rideStats: null }));
    expect(r.factors.vsAvg?.points).toBe(2);
  });

  it('+1 when 10-25% below average', () => {
    // currentWait=25, bucket0=30: delta = -16.7%
    const r = scoreRide(makeRide({ currentWait: 25, historicalAverage: makeHA(30, 30, 30), rideStats: null }));
    expect(r.factors.vsAvg?.points).toBe(1);
  });

  it('0 when within ±10%', () => {
    // currentWait=30, bucket0=30: delta = 0%
    const r = scoreRide(makeRide({ currentWait: 30, historicalAverage: makeHA(30, 30, 30), rideStats: null }));
    expect(r.factors.vsAvg?.points).toBe(0);
  });

  it('-1 when 10-25% above average', () => {
    // currentWait=35, bucket0=30: delta = +16.7%
    const r = scoreRide(makeRide({ currentWait: 35, historicalAverage: makeHA(30, 30, 30), rideStats: null }));
    expect(r.factors.vsAvg?.points).toBe(-1);
  });

  it('-2 when >25% above average', () => {
    // currentWait=45, bucket0=30: delta = +50%
    const r = scoreRide(makeRide({ currentWait: 45, historicalAverage: makeHA(30, 30, 30), rideStats: null }));
    expect(r.factors.vsAvg?.points).toBe(-2);
  });

  it('skips Factor 1 when bucket0.wait is 0', () => {
    const r = scoreRide(makeRide({ currentWait: 10, historicalAverage: makeHA(0, 30, 30), rideStats: null }));
    expect(r.factors.vsAvg).toBeNull();
  });
});

// --- Factor 2: position in p10/p90 range ---

describe('Factor 2 — vs range', () => {
  it('+2 when currentWait at or below p10', () => {
    // p10=30, p90=80, currentWait=25 (below floor)
    const r = scoreRide(makeRide({ currentWait: 25, historicalAverage: makeHA(40, 40, 40), rideStats: makeStats(30, 80) }));
    expect(r.factors.vsRange?.points).toBe(2);
  });

  it('+2 when currentWait exactly equals p10', () => {
    const r = scoreRide(makeRide({ currentWait: 30, historicalAverage: makeHA(40, 40, 40), rideStats: makeStats(30, 80) }));
    expect(r.factors.vsRange?.points).toBe(2);
  });

  it('+1 when in bottom quartile of range', () => {
    // p10=20, p90=80, range=60, 25% mark=35. currentWait=30 < 35
    const r = scoreRide(makeRide({ currentWait: 30, historicalAverage: makeHA(40, 40, 40), rideStats: makeStats(20, 80) }));
    expect(r.factors.vsRange?.points).toBe(1);
  });

  it('0 when in middle of range', () => {
    // p10=10, p90=90, range=80. currentWait=50 → pct=0.5
    const r = scoreRide(makeRide({ currentWait: 50, historicalAverage: makeHA(40, 40, 40), rideStats: makeStats(10, 90) }));
    expect(r.factors.vsRange?.points).toBe(0);
  });

  it('-1 when in top quartile of range', () => {
    // p10=10, p90=90, range=80, 75% mark=70. currentWait=80 > 70
    const r = scoreRide(makeRide({ currentWait: 80, historicalAverage: makeHA(40, 40, 40), rideStats: makeStats(10, 90) }));
    expect(r.factors.vsRange?.points).toBe(-1);
  });

  it('-2 when currentWait at or above p90', () => {
    const r = scoreRide(makeRide({ currentWait: 90, historicalAverage: makeHA(40, 40, 40), rideStats: makeStats(20, 80) }));
    expect(r.factors.vsRange?.points).toBe(-2);
  });

  it('skips Factor 2 when rideStats is null', () => {
    const r = scoreRide(makeRide({ rideStats: null }));
    expect(r.factors.vsRange).toBeNull();
  });

  it('skips Factor 2 when p90-p10 < 5', () => {
    const r = scoreRide(makeRide({ rideStats: makeStats(30, 33) })); // range = 3
    expect(r.factors.vsRange).toBeNull();
  });
});

// --- Factor 3: trend ---

describe('Factor 3 — trend', () => {
  it('+1 when bucket2 is >10% higher than bucket0 (rising)', () => {
    // bucket0=30, bucket2=34 (>30*1.1=33)
    const r = scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 34), rideStats: null }));
    expect(r.factors.trend).toEqual({ direction: 'up', points: 1 });
  });

  it('-1 when bucket2 is >10% lower than bucket0 (falling)', () => {
    // bucket0=30, bucket2=26 (<30*0.9=27)
    const r = scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 26), rideStats: null }));
    expect(r.factors.trend).toEqual({ direction: 'down', points: -1 });
  });

  it('0 when within ±10% (stable)', () => {
    const r = scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 30), rideStats: null }));
    expect(r.factors.trend).toEqual({ direction: 'stable', points: 0 });
  });
});

// --- Badge thresholds ---

describe('badge thresholds', () => {
  it('go badge when score >= +2', () => {
    // F1: currentWait=20 vs avg=30 → +2. F2/F3: skip/stable → total +2
    const r = scoreRide(makeRide({ currentWait: 20, historicalAverage: makeHA(30, 30, 30), rideStats: null }));
    expect(r.badge).toBe('go');
    expect(r.score).toBe(2);
  });

  it('skip badge when score <= -2', () => {
    // F1: currentWait=45 vs avg=30 → -2. total -2
    const r = scoreRide(makeRide({ currentWait: 45, historicalAverage: makeHA(30, 30, 30), rideStats: null }));
    expect(r.badge).toBe('skip');
    expect(r.score).toBe(-2);
  });

  it('no badge when score is +1', () => {
    // F1: currentWait=25 vs avg=30 → +1. total +1
    const r = scoreRide(makeRide({ currentWait: 25, historicalAverage: makeHA(30, 30, 30), rideStats: null }));
    expect(r.badge).toBeNull();
    expect(r.score).toBe(1);
  });

  it('no badge when score is -1', () => {
    // F1: currentWait=35 vs avg=30 → -1. total -1
    const r = scoreRide(makeRide({ currentWait: 35, historicalAverage: makeHA(30, 30, 30), rideStats: null }));
    expect(r.badge).toBeNull();
    expect(r.score).toBe(-1);
  });

  it('combined: all three factors produce score +4 → go', () => {
    // F1: currentWait=15 vs avg=30 → delta=-50% → +2
    // F2: p10=20, p90=80, pct<0 (below floor) → +2
    // F3: bucket2=35 > 30*1.1 → +1
    // Total: +5 → go
    const r = scoreRide(makeRide({
      currentWait: 15,
      historicalAverage: makeHA(30, 30, 35),
      rideStats: makeStats(20, 80),
    }));
    expect(r.badge).toBe('go');
    expect(r.score).toBe(5);
  });
});
