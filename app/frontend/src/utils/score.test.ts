import { scoreRide, ScoreResult } from './score';
import { Ride, HistoricalAverage, RideStats } from '../types';

function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: 'ride-1',
    name: 'Test Ride',
    land: 'Testland',
    status: 'OPERATING',
    currentWait: 30,
    historicalAverage: makeHA(30, 30, 30, 30, 30),
    rideStats: makeStats(15, 60),
    prediction: null,
    ...overrides,
  };
}

// b0=t+0, b1=t+30, b2=t+60, b3=t+90, b4=t+120
// Factor 3 uses: earlyAvg=avg(b0,b1) vs lateAvg=avg(b3,b4)
function makeHA(
  b0Wait: number | null,
  b1Wait: number | null,
  b2Wait: number | null,
  b3Wait: number | null = b2Wait,
  b4Wait: number | null = b2Wait,
  sampleCount = 50
): HistoricalAverage {
  return {
    dayType: 'weekday',
    buckets: [
      { offsetMinutes: 0,   timeSlot: '10:00-10:30', wait: b0Wait, sampleCount },
      { offsetMinutes: 30,  timeSlot: '10:30-11:00', wait: b1Wait, sampleCount },
      { offsetMinutes: 60,  timeSlot: '11:00-11:30', wait: b2Wait, sampleCount },
      { offsetMinutes: 90,  timeSlot: '11:30-12:00', wait: b3Wait, sampleCount },
      { offsetMinutes: 120, timeSlot: '12:00-12:30', wait: b4Wait, sampleCount },
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
      scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 30, 30, 30, 5) })).badge
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

// --- Factor 3: projected change (earlyAvg vs lateAvg) ---
// earlyAvg = avg(bucket0, bucket1)  lateAvg = avg(bucket3, bucket4)

describe('Factor 3 — projected change (early vs late window)', () => {
  it('+2 when lateAvg is >25% higher than earlyAvg (big rise)', () => {
    // earlyAvg=avg(30,30)=30, lateAvg=avg(40,40)=40: delta=+33%
    const r = scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 30, 40, 40), rideStats: null }));
    expect(r.factors.projectedChange?.points).toBe(2);
  });

  it('+1 when lateAvg is 10-25% higher than earlyAvg (small rise)', () => {
    // earlyAvg=avg(80,80)=80, lateAvg=avg(90,90)=90: delta=+12.5%, |diff|=10 → +1
    const r = scoreRide(makeRide({ historicalAverage: makeHA(80, 80, 80, 90, 90), rideStats: null }));
    expect(r.factors.projectedChange?.points).toBe(1);
  });

  it('0 when within ±10% (stable)', () => {
    // earlyAvg=30, lateAvg=30: delta=0
    const r = scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 30, 30, 30), rideStats: null }));
    expect(r.factors.projectedChange?.points).toBe(0);
    expect(r.factors.projectedChange?.delta).toBe(0);
  });

  it('-1 when lateAvg is 10-25% lower than earlyAvg (small drop)', () => {
    // earlyAvg=avg(80,80)=80, lateAvg=avg(70,70)=70: delta=-12.5%, |diff|=10 → -1
    const r = scoreRide(makeRide({ historicalAverage: makeHA(80, 80, 80, 70, 70), rideStats: null }));
    expect(r.factors.projectedChange?.points).toBe(-1);
  });

  it('-2 when lateAvg is >25% lower than earlyAvg (big drop)', () => {
    // earlyAvg=30, lateAvg=avg(20,20)=20: delta=-33%
    const r = scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 30, 20, 20), rideStats: null }));
    expect(r.factors.projectedChange?.points).toBe(-2);
  });

  it('null when both late buckets are null', () => {
    const r = scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 30, null, null), rideStats: null }));
    expect(r.factors.projectedChange).toBeNull();
  });

  it('null when bucket0.wait is 0', () => {
    const r = scoreRide(makeRide({ historicalAverage: makeHA(0, 30, 30, 30, 30), rideStats: null }));
    expect(r.factors.projectedChange).toBeNull();
  });

  it('oscillating data reads as stable: 60/50/55/50/55', () => {
    // earlyAvg=avg(60,50)=55, lateAvg=avg(50,55)=52.5: delta=-4.5% → within ±10% → 0
    const r = scoreRide(makeRide({ historicalAverage: makeHA(60, 50, 55, 50, 55), rideStats: null }));
    expect(r.factors.projectedChange?.points).toBe(0);
  });

  it('uses one valid bucket when the other is null', () => {
    // earlyAvg=avg(30,null)=30, lateAvg=avg(null,20)=20: delta=-33% → -2
    const r = scoreRide(makeRide({ historicalAverage: makeHA(30, null, 30, null, 20), rideStats: null }));
    expect(r.factors.projectedChange?.points).toBe(-2);
  });

  it('noise filter: 0 pts when |lateAvg - earlyAvg| < 10 min, even if % threshold would fire', () => {
    // earlyAvg=avg(30,30)=30, lateAvg=avg(37,37)=37: delta=+23% (would be +1) but |diff|=7 < 10 → 0
    const r = scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 30, 37, 37), rideStats: null }));
    expect(r.factors.projectedChange?.points).toBe(0);
    expect(r.factors.projectedChange?.delta).toBeCloseTo(7 / 30, 5);
  });

  it('noise filter: still fires when |lateAvg - earlyAvg| >= 10 min', () => {
    // earlyAvg=30, lateAvg=avg(41,41)=41: |diff|=11 >= 10, delta=+36% → +2
    const r = scoreRide(makeRide({ historicalAverage: makeHA(30, 30, 30, 41, 41), rideStats: null }));
    expect(r.factors.projectedChange?.points).toBe(2);
  });

  it('King Arthur pattern: 5-min wait vs 7-min avg, projecting 6 min — F3 noise filtered, delta stored', () => {
    // earlyAvg=avg(7,7)=7, lateAvg=avg(6,6)=6: |diff|=1 < 10 → F3 points=0, delta still stored
    const r = scoreRide(makeRide({
      currentWait: 5,
      historicalAverage: makeHA(7, 7, 7, 6, 6),
      rideStats: null,
    }));
    expect(r.factors.projectedChange?.points).toBe(0);
    expect(r.factors.projectedChange?.delta).toBeCloseTo(-1 / 7, 5);
  });

  it('Indiana Jones case: 40% projected drop fires skip badge alone', () => {
    // earlyAvg=avg(70,50)=60, lateAvg=avg(36,36)=36: delta=-40% → F3=-2
    // F1=0 (current at avg), F2 skipped → total -2 → skip
    const r = scoreRide(makeRide({
      currentWait: 70,
      historicalAverage: makeHA(70, 50, 50, 36, 36),
      rideStats: null,
    }));
    expect(r.factors.projectedChange?.points).toBe(-2);
    expect(r.score).toBe(-2);
    expect(r.badge).toBe('skip');
  });
});

// --- "Go" badge suppression when future dip > 30% ---

describe('"go" suppression — future dip', () => {
  it('suppresses go badge when delta < -30%', () => {
    // F1=+2 (currentWait=15 vs avg=30), F2=+2 (below p10=20), F3=-2 (lateAvg=20 vs earlyAvg=30 → -33%)
    // score=2 → go → delta=-33% < -30% → badge suppressed to null
    const r = scoreRide(makeRide({
      currentWait: 15,
      historicalAverage: makeHA(30, 30, 30, 20, 20),
      rideStats: makeStats(20, 80),
    }));
    expect(r.score).toBe(2);
    expect(r.badge).toBeNull();
  });

  it('does NOT suppress go badge when delta is -20%', () => {
    // F1=+2, F2=+2, F3=-1 (lateAvg=24 vs earlyAvg=30 → -20%): score=3 → go, -20% > -30% → no suppress
    const r = scoreRide(makeRide({
      currentWait: 15,
      historicalAverage: makeHA(30, 30, 30, 24, 24),
      rideStats: makeStats(20, 80),
    }));
    expect(r.badge).toBe('go');
  });

  it('does NOT suppress go badge when late buckets are null', () => {
    // projectedChange=null → suppression check skipped
    const r = scoreRide(makeRide({
      currentWait: 15,
      historicalAverage: makeHA(30, 30, 30, null, null),
      rideStats: makeStats(20, 80),
    }));
    expect(r.badge).toBe('go');
  });

  it('does not suppress skip badge', () => {
    // skip badge is never suppressed by this rule
    const r = scoreRide(makeRide({
      currentWait: 45,
      historicalAverage: makeHA(30, 30, 30, 20, 20),
      rideStats: null,
    }));
    expect(r.badge).toBe('skip');
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

  it('King Arthur regression: 5-min wait vs 7-min avg → no badge (both F1 and F3 noise-filtered)', () => {
    // F1: |5-7|=2 < 5min floor → 0. F2: near p10 of narrow range → +1. F3: |6-7|=1 < 10min → 0.
    // Score +1 → no badge.
    const r = scoreRide(makeRide({
      currentWait: 5,
      historicalAverage: makeHA(7, 7, 7, 6, 6),
      rideStats: makeStats(3, 12),
    }));
    expect(r.factors.vsAvg?.points).toBe(0);
    expect(r.factors.projectedChange?.points).toBe(0);
    expect(r.badge).toBeNull();
  });

  it('combined: high-score go that does NOT qualify for gold star', () => {
    // F1: currentWait=22 vs avg=30 → -27% → +2 (above -30% gold star threshold)
    // F2: p10=20, p90=80, currentWait=22 > p10, pct=3.3% < 25% → +1
    // F3: earlyAvg=30, lateAvg=40 → +33% → +2
    // Total +5 → go. Gold star fails on the -30% rule (vsAvg.delta=-27%).
    const r = scoreRide(makeRide({
      currentWait: 22,
      historicalAverage: makeHA(30, 30, 30, 40, 40),
      rideStats: makeStats(20, 80),
    }));
    expect(r.badge).toBe('go');
    expect(r.score).toBe(5);
  });
});

// --- Gold star: rare opportunity ---

describe('gold star', () => {
  // Canonical gold-star fixture: at the floor, far below avg, rising fast.
  const goldStarRide = () => makeRide({
    currentWait: 20,
    historicalAverage: makeHA(50, 50, 50, 60, 60),  // earlyAvg=50, lateAvg=60 → +20%
    rideStats: makeStats(20, 80),                    // p10=20, currentWait=20 ≤ p10*1.15=23
  });

  it('fires when all three conditions hold', () => {
    // 20 ≤ p10*1.15 (floor ✓), vsAvg.delta = (20-50)/50 = -60% (✓), projectedChange = +20% (✓)
    const r = scoreRide(goldStarRide());
    expect(r.badge).toBe('star');
  });

  it('overrides what would otherwise be a go badge', () => {
    // F1=+2 (-60%), F2=+2 (at p10), F3=+1 (+20% rise, |diff|=10) → score +5 → would be go
    const r = scoreRide(goldStarRide());
    expect(r.score).toBeGreaterThanOrEqual(2);
    expect(r.badge).toBe('star');
    expect(r.badge).not.toBe('go');
  });

  it('does NOT fire when rideStats is null', () => {
    const r = scoreRide({ ...goldStarRide(), rideStats: null });
    expect(r.badge).not.toBe('star');
  });

  it('does NOT fire when currentWait > p10 × 1.15', () => {
    // currentWait=24, p10=20, p10*1.15=23 → above floor band
    const r = scoreRide({ ...goldStarRide(), currentWait: 24 });
    expect(r.badge).not.toBe('star');
  });

  it('does NOT fire when vsAvg.delta >= -0.30 (not far enough below average)', () => {
    // currentWait=20, bucket0=27 → delta=-26% (fails -30% threshold)
    // Keep floor and rising-trend conditions satisfied via fixture tweak.
    const r = scoreRide({
      ...goldStarRide(),
      historicalAverage: makeHA(27, 27, 27, 38, 38), // earlyAvg=27, lateAvg=38 → +41%
    });
    // vsAvg = (20-27)/27 = -26% → gold star fails
    expect(r.factors.vsAvg?.delta).toBeCloseTo(-7 / 27, 5);
    expect(r.badge).not.toBe('star');
  });

  it('does NOT fire when projectedChange.delta <= 0.10 (line not rising)', () => {
    // earlyAvg=50, lateAvg=53 → +6% (below +10% threshold)
    const r = scoreRide({
      ...goldStarRide(),
      historicalAverage: makeHA(50, 50, 50, 53, 53),
    });
    expect(r.badge).not.toBe('star');
  });

  it('does NOT fire when projectedChange is null (no late-bucket data)', () => {
    const r = scoreRide({
      ...goldStarRide(),
      historicalAverage: makeHA(50, 50, 50, null, null),
    });
    expect(r.factors.projectedChange).toBeNull();
    expect(r.badge).not.toBe('star');
  });
});
