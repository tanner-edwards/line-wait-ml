import { scoreRide } from './score';
import { Ride, HistoricalAverage, RideStats, FullDaySlot, RecentSnapshot, Prediction } from '../types';

// NOTE (2026-08-11): the two-layer engine (layer1.ts + layer2.ts) is now the
// authoritative verdict — handler.ts OVERRIDES `score.badge` with it. So
// scoreRide's own `badge` output is dead code and is NOT asserted here.
// What IS still live: `score.factors` (zone/typical/worthWeight/valueMinutes/
// betterWindow*/recoverableNet/trajectory/rapidChange) and the signed `score`,
// both consumed by promptBuilder (LLM prompt) + the recommendations sort. This
// suite locks that contract until score.ts is retired.

const SLOT_START = 720; // buckets[0] timeSlot '12:00-12:30' → 720 min past LA midnight

function ha(typical: number | null, sampleCount = 50): HistoricalAverage {
  const b = (offsetMinutes: 0 | 30 | 60 | 90 | 120 | 150) => ({
    offsetMinutes, timeSlot: '12:00-12:30', wait: typical, sampleCount,
  });
  return { dayType: 'weekday', buckets: [b(0), b(30), b(60), b(90), b(120), b(150)] };
}
function stats(p10: number, p50: number, p90: number, sampleCount = 200): RideStats {
  return { p10, p50, p90, sampleCount };
}
function forecast(slots: { dtMin: number; wait: number | null }[]): FullDaySlot[] {
  return slots.map(s => ({ timeSlot: 'x', startMinutes: SLOT_START + s.dtMin, wait: s.wait, sampleCount: 50 }));
}
function prevSnap(wait: number, status = 'OPERATING'): RecentSnapshot[] {
  return [{ timestamp: '2026-07-28T19:00:00Z', minutesAgo: 10, wait, status }];
}
function pred(trend: Prediction['trend'], confidence: Prediction['confidence'] = 'high'): Prediction {
  return {
    t10: 30, t20: 30, t30: 30, t40: 30, t50: 30, t60: 30,
    t90: 30, t120: 30, t150: 30, t180: 30, t210: 30, t240: 30,
    trend, trendDelta30: 0, confidence, updatedAt: '2026-07-28T19:00:00Z',
  } as Prediction;
}
function makeRide(o: Partial<Ride> & { current?: number } = {}): Ride {
  const { current, ...rest } = o;
  return {
    id: 'r', name: 'Test', land: 'L', status: 'OPERATING',
    currentWait: current ?? 30,
    historicalAverage: ha(30),
    historicalBaseline: null,
    rideStats: stats(10, 30, 60),
    prediction: null,
    fullDayForecast: null,
    recentHistory: null,
    lat: null, lng: null, closedAt: null,
    ...rest,
  } as Ride;
}

// --- Suppression → the SUPPRESSED result (all factors null, score 0) ---
describe('suppression', () => {
  it('null currentWait → suppressed factors, score 0', () => {
    // pass currentWait via rest — the `current` helper coalesces null→30.
    const r = scoreRide(makeRide({ currentWait: null }));
    expect(r.factors.zone).toBe('suppressed');
    expect(r.factors.typical).toBeNull();
    expect(r.score).toBe(0);
  });
  it('not OPERATING → suppressed', () => {
    expect(scoreRide(makeRide({ status: 'DOWN' })).factors.zone).toBe('suppressed');
  });
  it('too-few-samples typical bucket → suppressed', () => {
    expect(scoreRide(makeRide({ historicalAverage: ha(30, 5) })).factors.zone).toBe('suppressed');
  });
  it('degenerate distribution (p10=p50=p90) → zone suppressed but typical retained', () => {
    const r = scoreRide(makeRide({ current: 5, rideStats: stats(5, 5, 5) }));
    expect(r.factors.zone).toBe('suppressed');
    expect(r.factors.typical).toBe(30);          // baseline still passed through
    expect(r.factors.rapidChange).toBeNull();
  });
});

// --- Zone classification (rank on p10/p90) ---
describe('zone', () => {
  it('below p10 → opportunity', () => {
    expect(scoreRide(makeRide({ current: 5 })).factors.zone).toBe('opportunity');
  });
  it('at/above p90 → skip', () => {
    expect(scoreRide(makeRide({ current: 60 })).factors.zone).toBe('skip');
  });
  it('between p10 and p90 → judgment', () => {
    expect(scoreRide(makeRide({ current: 30 })).factors.zone).toBe('judgment');
  });
});

// --- typical + worthWeight passthrough ---
describe('typical & worthWeight', () => {
  it('prefers historicalBaseline over historicalAverage for typical', () => {
    const r = scoreRide(makeRide({ historicalBaseline: ha(28), historicalAverage: ha(30) }));
    expect(r.factors.typical).toBe(28);
  });
  it('worthWeight = p50 / 40', () => {
    expect(scoreRide(makeRide({ rideStats: stats(10, 40, 60) })).factors.worthWeight).toBeCloseTo(1.0);
  });
});

// --- valueMinutes worth gate (p90 ≥ 25) ---
describe('valueMinutes', () => {
  it('null when the ride cannot get busy (p90 < 25 → filler)', () => {
    const r = scoreRide(makeRide({ current: 5, rideStats: stats(2, 8, 20), historicalAverage: ha(8) }));
    expect(r.factors.valueMinutes).toBeNull();
  });
  it('worth-weighted minutes when worthy: (typical − current) × p50/40', () => {
    // typical 30, current 20, p50 30 → (30−20)×0.75 = 7.5
    const r = scoreRide(makeRide({ current: 20, rideStats: stats(10, 30, 60), historicalAverage: ha(30) }));
    expect(r.factors.valueMinutes).toBeCloseTo(7.5);
  });
});

// --- Best window (Axis 2) from the forecast ---
describe('better window', () => {
  it('surfaces the reachability-weighted best future window', () => {
    // 45 now → 10 in 1h. raw = 45−10−12 = 23; decay(1h)=0.925 → ~21.3.
    const r = scoreRide(makeRide({
      current: 45, rideStats: stats(5, 25, 60), historicalAverage: ha(35),
      fullDayForecast: forecast([{ dtMin: 60, wait: 10 }]),
    }));
    expect(r.factors.betterWindowWait).toBe(10);
    expect(r.factors.betterWindowInMin).toBe(60);
    expect(r.factors.recoverableNet).toBeCloseTo(21.3, 0);
    expect(r.factors.reachableSoon).toBe(true);
  });
  it('falls back to p10 (far, decayed) when no forecast exists', () => {
    const r = scoreRide(makeRide({ current: 60, rideStats: stats(10, 30, 60) }));
    expect(r.factors.betterWindowWait).toBe(10);
    expect(r.factors.betterWindowInMin).toBe(240);
    expect(r.factors.reachableSoon).toBe(false);
  });
});

// --- Trajectory (from ML, confidence-gated) ---
describe('trajectory', () => {
  it('reflects the ML trend when confidence is high', () => {
    expect(scoreRide(makeRide({ prediction: pred('falling', 'high') })).factors.trajectory).toBe('falling');
  });
  it('is null when ML confidence is low', () => {
    expect(scoreRide(makeRide({ prediction: pred('rising', 'low') })).factors.trajectory).toBeNull();
  });
  it('is null when there is no prediction', () => {
    expect(scoreRide(makeRide({ prediction: null })).factors.trajectory).toBeNull();
  });
});

// --- Rapid change ---
describe('rapidChange', () => {
  it('populates on a real swing vs the previous snapshot', () => {
    const r = scoreRide(makeRide({ current: 30, recentHistory: prevSnap(60) }));
    expect(r.factors.rapidChange).not.toBeNull();
    expect(r.factors.rapidChange!.delta).toBeCloseTo(-0.5);
  });
  it('ignores a reopen-from-DOWN previous snapshot', () => {
    const r = scoreRide(makeRide({ current: 30, recentHistory: prevSnap(0, 'DOWN') }));
    expect(r.factors.rapidChange).toBeNull();
  });
});

// --- Signed score currency (consumed by the recommendations sort) ---
describe('signed score', () => {
  it('is positive for an opportunity (worthy ride at its floor)', () => {
    const r = scoreRide(makeRide({ current: 5, rideStats: stats(10, 30, 60), historicalAverage: ha(30) }));
    expect(r.score).toBeGreaterThan(0);
  });
  it('is negative for a skip (at/above its ceiling)', () => {
    const r = scoreRide(makeRide({ current: 60, rideStats: stats(10, 30, 60), historicalAverage: ha(30) }));
    expect(r.score).toBeLessThan(0);
  });
});
