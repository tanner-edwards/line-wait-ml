import { dealVerdict } from './layer1';
import { Ride, HistoricalAverage, RideStats, FullDaySlot } from '../types';

// Layer 1 = pure RELATIVE deal math (go/skip/neutral). It ignores absolute
// minutes and ride worth (those are Layer 2). Two frames: A = vs time-of-day
// typical; B = vs today's remaining predicted shape.
//
// Coupling to know: `beatableSoon` (and all of Frame B) is computed only when
// the remaining curve has ≥2 points — so any skip fixture needs ≥2 forecast
// slots. Production's ML curve supplies ~12, so this is a fixture concern only.

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
    historicalAverage: ha(typical ?? 40),
    historicalBaseline: null,
    rideStats: stats(20, 50, 80),
    prediction: null, fullDayForecast: null, recentHistory: null,
    lat: null, lng: null, closedAt: null,
    ...rest,
  } as Ride;
}

describe('Frame A — vs time-of-day typical', () => {
  it('GO when ≥20% below typical', () => {
    const r = dealVerdict(makeRide({ current: 24, typical: 40 })); // 24 ≤ 0.8·40
    expect(r.verdict).toBe('go');
    expect(r.frameAGo).toBe(true);
  });
  it('not a Frame-A GO when only slightly below typical', () => {
    const r = dealVerdict(makeRide({ current: 36, typical: 40 })); // 36 > 32
    expect(r.frameAGo).toBe(false);
  });
});

describe('Frame B — vs today\'s remaining shape', () => {
  it('GO when current sits at/below today-remaining p30 (even if not below typical)', () => {
    const r = dealVerdict(makeRide({
      current: 35, typical: 40,
      fullDayForecast: forecast([{ dtMin: 30, wait: 35 }, { dtMin: 60, wait: 60 }, { dtMin: 120, wait: 70 }]),
    }));
    expect(r.verdict).toBe('go');
    expect(r.frameBGo).toBe(true);
    expect(r.frameAGo).toBe(false);
  });
});

describe('ceiling_beatable SKIP (LOCKED)', () => {
  it('SKIP at/above p90 WHEN a better window is reachable soon', () => {
    const r = dealVerdict(makeRide({
      current: 60, typical: 40, rideStats: stats(20, 40, 55),
      fullDayForecast: forecast([{ dtMin: 30, wait: 30 }, { dtMin: 60, wait: 35 }]),
    }));
    expect(r.verdict).toBe('skip');
    expect(r.ceiling).toBe(true);
    expect(r.beatableSoon).toBe(true);
  });
  it('NEUTRAL at its ceiling when nothing better is coming (can\'t beat it → not a skip)', () => {
    const r = dealVerdict(makeRide({
      current: 60, typical: 40, rideStats: stats(20, 40, 55),
      fullDayForecast: forecast([{ dtMin: 30, wait: 58 }, { dtMin: 60, wait: 59 }]),
    }));
    expect(r.verdict).toBe('neutral');
    expect(r.ceiling).toBe(true);
    expect(r.beatableSoon).toBe(false);
  });
});

describe('"about to drop" SKIP (big reachable fall, no Frame-A corroboration)', () => {
  it('SKIPS when high-for-today AND a BIG drop is reachable, even near its typical', () => {
    const r = dealVerdict(makeRide({
      current: 45, typical: 47, rideStats: stats(10, 43, 75),   // ≈ typical, below p90
      fullDayForecast: forecast([
        { dtMin: 30, wait: 34 }, { dtMin: 60, wait: 23 },
        { dtMin: 120, wait: 13 }, { dtMin: 150, wait: 8 },
      ]),
    }));
    expect(r.verdict).toBe('skip');
    expect(r.frameASkip).toBe(false);      // NOT above its usual
    expect(r.ceiling).toBe(false);
    expect(r.bigBeatableSoon).toBe(true);
  });
  it('does NOT skip on a modest drop without Frame-A corroboration', () => {
    const r = dealVerdict(makeRide({
      current: 30, typical: 32, rideStats: stats(10, 30, 60),
      fullDayForecast: forecast([{ dtMin: 30, wait: 20 }, { dtMin: 60, wait: 10 }, { dtMin: 120, wait: 12 }]),
    }));
    expect(r.beatableSoon).toBe(true);
    expect(r.bigBeatableSoon).toBe(false);
    expect(r.verdict).toBe('neutral');
  });
});

describe('flat-day guard (skip side only)', () => {
  it('a corroborated high on a FLAT remaining range does NOT skip', () => {
    const r = dealVerdict(makeRide({
      current: 50, typical: 40, rideStats: stats(20, 50, 80), // above typical, below p90
      fullDayForecast: forecast([{ dtMin: 30, wait: 48 }, { dtMin: 60, wait: 50 }]), // spread 2 < 10
    }));
    expect(r.flatDay).toBe(true);
    expect(r.frameBSkip).toBe(false);
    expect(r.verdict).toBe('neutral');
  });
  it('but a Frame-B GO still fires on a flat range (now is the low)', () => {
    const r = dealVerdict(makeRide({
      current: 48, typical: 60, rideStats: stats(20, 50, 80),
      fullDayForecast: forecast([{ dtMin: 30, wait: 48 }, { dtMin: 60, wait: 50 }]),
    }));
    expect(r.flatDay).toBe(true);
    expect(r.frameBGo).toBe(true);
    expect(r.verdict).toBe('go');
  });
});

describe('conflict resolution — GO wins', () => {
  it('Frame A says skip (high vs morning typical) but Frame B says go (today\'s low) → GO', () => {
    const r = dealVerdict(makeRide({
      current: 45, typical: 30, rideStats: stats(20, 50, 80),
      fullDayForecast: forecast([{ dtMin: 30, wait: 50 }, { dtMin: 60, wait: 60 }, { dtMin: 120, wait: 70 }]),
    }));
    expect(r.verdict).toBe('go');
    expect(r.frameASkip).toBe(true);
    expect(r.frameBGo).toBe(true);
  });
});

describe('neutral', () => {
  it('at typical, mid-distribution, no better window → neutral', () => {
    const r = dealVerdict(makeRide({ current: 50, typical: 50, rideStats: stats(20, 50, 80) }));
    expect(r.verdict).toBe('neutral');
  });
  it('missing rideStats → neutral (cannot rank)', () => {
    const r = dealVerdict(makeRide({ current: 30, rideStats: null }));
    expect(r.verdict).toBe('neutral');
  });
});
