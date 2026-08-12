import { scoreVerdict } from './layer2';
import { Ride, HistoricalAverage, RideStats, FullDaySlot } from '../types';

const SLOT_START = 720; // buckets[0] timeSlot '12:00-12:30' → 720 min past LA midnight

function ha(typical: number | null): HistoricalAverage {
  const b = (offsetMinutes: 0 | 30 | 60 | 90 | 120 | 150) => ({
    offsetMinutes, timeSlot: '12:00-12:30', wait: typical, sampleCount: 50,
  });
  return { dayType: 'weekday', buckets: [b(0), b(30), b(60), b(90), b(120), b(150)] };
}
function stats(p10: number, p50: number, p90: number): RideStats {
  return { p10, p50, p90, sampleCount: 200 };
}
function forecast(slots: { dtMin: number; wait: number | null }[]): FullDaySlot[] {
  return slots.map(s => ({ timeSlot: 'x', startMinutes: SLOT_START + s.dtMin, wait: s.wait, sampleCount: 50 }));
}
function makeRide(o: Partial<Ride> & { current?: number; typical?: number } = {}): Ride {
  const { current, typical, ...rest } = o;
  return {
    id: 'r', name: 'Test', land: 'L', status: 'OPERATING',
    currentWait: current ?? 30,
    historicalAverage: ha(typical ?? 30),
    historicalBaseline: null,
    rideStats: stats(10, 30, 60),
    prediction: null, fullDayForecast: null, recentHistory: null,
    lat: null, lng: null, closedAt: null,
    ...rest,
  } as Ride;
}

describe('Layer 2 — worth filter', () => {
  it('mutes a relatively-low FILLER (p90 < 20) to neutral', () => {
    // frameA GO (5 ≤ 0.8·10) but the ride is always short → timing is noise
    const r = scoreVerdict(makeRide({ current: 5, typical: 10, rideStats: stats(5, 8, 15) }));
    expect(r.verdict).toBe('neutral');
    expect(r.suppressed).toBe(true);
    expect(r.reasons.primary).toBe('filler');
  });
});

describe('Layer 2 — star elevation', () => {
  it('elevates a worthy GO at its floor, ≥30% below typical, to STAR', () => {
    const r = scoreVerdict(makeRide({ current: 15, typical: 40, rideStats: stats(20, 40, 60) }));
    expect(r.verdict).toBe('star');
    expect(r.star).toBe(true);
    expect(r.reasons.primary).toBe('rare-low');
  });
  it('does NOT star when the drop is a small % of a high-scale ride', () => {
    // 70 off an 80-typical ride is only ~12% below → GO, not STAR
    const r = scoreVerdict(makeRide({ current: 62, typical: 80, rideStats: stats(60, 75, 95) }));
    expect(r.verdict).toBe('go');
    expect(r.star).toBe(false);
  });
});

describe('Layer 2 — five-minute tidy floor', () => {
  it('mutes a Frame-A GO whose drop is under 5 minutes', () => {
    // typical 20, current 16 → frameA GO (16 ≤ 16) but only a 4-min drop
    const r = scoreVerdict(makeRide({ current: 16, typical: 20, rideStats: stats(5, 15, 20) }));
    expect(r.verdict).toBe('neutral');
    expect(r.reasons.primary).toBe('trivial-drop');
  });
});

describe('Layer 2 — pass-through of real signals', () => {
  it('keeps a clean below-usual GO', () => {
    const r = scoreVerdict(makeRide({ current: 24, typical: 40, rideStats: stats(10, 30, 60) }));
    expect(r.verdict).toBe('go');
    expect(r.reasons.primary).toBe('below-usual');
  });

  it('labels a today-low GO as "todays-low"', () => {
    const r = scoreVerdict(makeRide({
      current: 35, typical: 40, rideStats: stats(20, 40, 60),
      fullDayForecast: forecast([{ dtMin: 30, wait: 35 }, { dtMin: 60, wait: 60 }, { dtMin: 120, wait: 70 }]),
    }));
    expect(r.verdict).toBe('go');
    expect(r.reasons.primary).toBe('todays-low');
  });

  it('keeps a ceiling SKIP with a reachable better window', () => {
    const r = scoreVerdict(makeRide({
      current: 60, typical: 40, rideStats: stats(20, 40, 55),
      fullDayForecast: forecast([{ dtMin: 30, wait: 30 }, { dtMin: 60, wait: 35 }]),
    }));
    expect(r.verdict).toBe('skip');
    expect(r.reasons.primary).toBe('at-ceiling');
  });

  it('stays neutral with no real decision', () => {
    const r = scoreVerdict(makeRide({ current: 40, typical: 40, rideStats: stats(10, 40, 60) }));
    expect(r.verdict).toBe('neutral');
    expect(r.suppressed).toBe(false);
    expect(r.reasons.primary).toBe('none');
  });

  it('SKIPS a ride about to drop hard, even near its usual (the Tiana case)', () => {
    // 45 now ≈ its typical 47 (Frame A neutral), but ML is falling to ~8 within
    // a few hours → a big reachable drop. Should skip via the new Frame-B path.
    const r = scoreVerdict(makeRide({
      current: 45, typical: 47, rideStats: stats(10, 43, 75),
      fullDayForecast: forecast([
        { dtMin: 30, wait: 34 }, { dtMin: 60, wait: 23 },
        { dtMin: 120, wait: 13 }, { dtMin: 150, wait: 8 },
      ]),
    }));
    expect(r.verdict).toBe('skip');
    expect(r.deal.frameASkip).toBe(false);     // NOT above its usual
    expect(r.deal.bigBeatableSoon).toBe(true);
    expect(r.reasons.primary).toBe('dropping-soon');
  });

  it('stays NEUTRAL (silent) when only a modest drop is coming and Frame A is neutral', () => {
    // high-for-today + a beatable-but-not-big drop, near typical → not a skip,
    // and NOT high-but-steady (a better window IS coming) → no line.
    const r = scoreVerdict(makeRide({
      current: 30, typical: 32, rideStats: stats(10, 30, 60),
      fullDayForecast: forecast([{ dtMin: 30, wait: 20 }, { dtMin: 60, wait: 10 }, { dtMin: 120, wait: 12 }]),
    }));
    expect(r.verdict).toBe('neutral');
    expect(r.deal.beatableSoon).toBe(true);
    expect(r.deal.bigBeatableSoon).toBe(false);
    expect(r.reasons.primary).toBe('none');
  });

  it('labels a high-but-not-beatable neutral as "high-but-steady" (the Pirates case)', () => {
    // At today's peak, but the only lower windows are far out → not a skip, and
    // NOT silent: the guest needs to know it's high yet not worth avoiding.
    const r = scoreVerdict(makeRide({
      current: 25, typical: 22, rideStats: stats(5, 18, 30),
      fullDayForecast: forecast([
        { dtMin: 30, wait: 24 }, { dtMin: 60, wait: 23 },
        { dtMin: 120, wait: 22 }, { dtMin: 600, wait: 10 },  // real low is 10h out
      ]),
    }));
    expect(r.verdict).toBe('neutral');
    expect(r.deal.beatableSoon).toBe(false);
    expect(r.reasons.primary).toBe('high-but-steady');
  });
});
