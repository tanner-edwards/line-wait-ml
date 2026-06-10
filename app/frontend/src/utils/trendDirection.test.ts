import { trendDirection, TrendInput } from './trendDirection';

// Convenience constructor — name + only-set fields, everything else null.
function input(overrides: Partial<TrendInput> = {}): TrendInput {
  return {
    currentWait: 30,
    recentWait: null,
    bucket1Wait: null,
    bucket3Wait: null,
    bucket4Wait: null,
    ...overrides,
  };
}

describe('trendDirection — combined past + future signal', () => {
  describe('null handling and fallbacks', () => {
    it('returns null when currentWait is null', () => {
      expect(trendDirection(input({ currentWait: null }))).toBeNull();
    });

    it('returns null when everything except current is missing', () => {
      expect(trendDirection(input())).toBeNull();
    });

    it('uses future-only when past data is missing', () => {
      // No recentWait → pastDelta=0. Future-only: earlyAvg=30, lateAvg=60 → +30.
      const r = trendDirection(input({
        currentWait: 30,
        bucket3Wait: 60,
        bucket4Wait: 60,
      }));
      expect(r).toBe('up');
    });

    it('uses past-only when all future buckets are missing', () => {
      // No future → futureDelta=0. Past: current=30, recent=15 → +15.
      const r = trendDirection(input({
        currentWait: 30,
        recentWait: 15,
      }));
      expect(r).toBe('up');
    });

    it('uses b4 alone when b3 is missing on the late side', () => {
      // No b3, b4=60. lateAvg=60. earlyAvg=avg(30,30)=30. delta=+30 → up.
      const r = trendDirection(input({
        currentWait: 30,
        bucket1Wait: 30,
        bucket4Wait: 60,
      }));
      expect(r).toBe('up');
    });

    it('uses b3 alone when b4 is missing on the late side', () => {
      const r = trendDirection(input({
        currentWait: 30,
        bucket1Wait: 30,
        bucket3Wait: 60,
      }));
      expect(r).toBe('up');
    });
  });

  describe('±5 min absolute threshold', () => {
    it("treats a +4 combined delta as 'stable'", () => {
      // same-direction: future=+2, past=+2 → combined = 2 + 0.4*2 = 2.8 → stable
      const r = trendDirection(input({
        currentWait: 30, recentWait: 28,
        bucket1Wait: 30, bucket3Wait: 32, bucket4Wait: 32,
      }));
      expect(r).toBe('stable');
    });

    it("boundary: weak same-direction signals stay 'stable' under new weighting", () => {
      // same-direction: future=+3, past=+2 → combined = 3 + 0.4*2 = 3.8 → stable
      // (old formula summed to 5 and fired 'up'; new formula weights past at 0.4)
      const r = trendDirection(input({
        currentWait: 30, recentWait: 28,
        bucket1Wait: 30, bucket3Wait: 33, bucket4Wait: 33,
      }));
      expect(r).toBe('stable');
    });

    it("future signal alone of +6 fires 'up' even with no past data", () => {
      // No recentWait → pastDelta null → combined = futureDelta = 6 → up
      const r = trendDirection(input({
        currentWait: 30,
        bucket1Wait: 30, bucket3Wait: 36, bucket4Wait: 36,
      }));
      expect(r).toBe('up');
    });
  });

  describe('agreement amplifies', () => {
    it("past rising + future rising → 'up' with high combined magnitude", () => {
      // past=+10 (recent=20 → 30), future=+30 (b3=b4=60, earlyAvg=30) → total +40
      const r = trendDirection(input({
        currentWait: 30, recentWait: 20,
        bucket1Wait: 30, bucket3Wait: 60, bucket4Wait: 60,
      }));
      expect(r).toBe('up');
    });

    it("past dropping + future dropping → 'down'", () => {
      // past=-10 (recent=40 → 30), future=-15 (b3=b4=15, earlyAvg=30) → total -25
      const r = trendDirection(input({
        currentWait: 30, recentWait: 40,
        bucket1Wait: 30, bucket3Wait: 15, bucket4Wait: 15,
      }));
      expect(r).toBe('down');
    });
  });

  describe("opposing signals — future wins", () => {
    it("past rising + future dropping → future wins → 'down' (peaking)", () => {
      // past=+10, future=-15 → opposing → combined = futureDelta = -15 → down
      const r = trendDirection(input({
        currentWait: 30, recentWait: 20,
        bucket1Wait: 30, bucket3Wait: 15, bucket4Wait: 15,
      }));
      expect(r).toBe('down');
    });

    it("past dropping + future rising → future wins → 'up' (bottoming)", () => {
      // past=-10, future=+8 → opposing → combined = futureDelta = +8 → up
      // The ride just dipped but the forward curve says it'll rise — go now.
      const r = trendDirection(input({
        currentWait: 30, recentWait: 40,
        bucket1Wait: 30, bucket3Wait: 38, bucket4Wait: 38,
      }));
      expect(r).toBe('up');
    });

    it("weak opposing signals: future=-6 wins over past=+5 → 'down'", () => {
      // past=+5, future=-6 → opposing → combined = futureDelta = -6 → down
      const r = trendDirection(input({
        currentWait: 30, recentWait: 25,
        bucket1Wait: 30, bucket3Wait: 24, bucket4Wait: 24,
      }));
      expect(r).toBe('down');
    });
  });

  // --- Regression tests for the reported bugs ---

  describe("regression: Space Mountain 6pm — was 'Steady', should be 'Rising'", () => {
    it("reads 'up' when current=60 and forward curve climbs 73→79→74", () => {
      // No recent movement: past=0, future = avg(79,74) - avg(60,73) = 76.5-66.5 = +10 → up.
      const r = trendDirection({
        currentWait: 60,
        recentWait: 60,
        bucket1Wait: 73,
        bucket3Wait: 79,
        bucket4Wait: 74,
      });
      expect(r).toBe('up');
    });

    it("reads 'up' even when wait recently dipped before the rise", () => {
      // past=-8 (68→60), future=+10 → opposing → future wins → combined=+10 → up.
      // This was the real-world case that showed 'Steady' before the fix.
      const r = trendDirection({
        currentWait: 60,
        recentWait: 68,
        bucket1Wait: 73,
        bucket3Wait: 79,
        bucket4Wait: 74,
      });
      expect(r).toBe('up');
    });
  });

  describe("regression: Winnie the Pooh 9pm at the floor — was 'Dropping', should be 'Steady'", () => {
    it("reads 'stable' when current=5 (floor), recent dropped to floor, future stays near floor", () => {
      // Floor guard: currentWait=5 ≤ 10 → pastDelta suppressed → null.
      // futureDelta = avg(6,6) - avg(5,11) = 6 - 8 = -2 → |combined|=2 < 5 → stable.
      const r = trendDirection({
        currentWait: 5,
        recentWait: 15,
        bucket1Wait: 11,
        bucket3Wait: 6,
        bucket4Wait: 6,
      });
      expect(r).toBe('stable');
    });

    it("reads 'stable' when current=5 and past was already at the floor", () => {
      // Floor guard applies (currentWait=5); future weak → stable.
      const r = trendDirection({
        currentWait: 5,
        recentWait: 5,
        bucket1Wait: 11,
        bucket3Wait: 6,
        bucket4Wait: 6,
      });
      expect(r).toBe('stable');
    });

    it("floor guard boundary: currentWait=11 retains pastDelta, both signals down → 'down'", () => {
      // currentWait=11 > 10 → pastDelta retained = 11-20 = -9.
      // futureDelta: earlyAvg=(11+11)/2=11, lateAvg=6 → -5. Same sign → combined = -5+0.4*(-9) = -8.6 → down.
      // Contrast with currentWait=5: floor guard suppresses past, futureDelta=-2 → stable.
      const r = trendDirection({
        currentWait: 11,
        recentWait: 20,
        bucket1Wait: 11,
        bucket3Wait: 6,
        bucket4Wait: 6,
      });
      expect(r).toBe('down');
    });
  });

  describe("regression: Finding Nemo 12pm — past spike already over, future flat", () => {
    it("reads 'stable' when recent spike (+20) is done and forward curve is flat", () => {
      // past=+20 (10→30), future: earlyAvg=(30+24)/2=27, lateAvg=(25+28)/2=26.5 → delta=-0.5
      // Opposing → future wins → combined = -0.5 → |combined| < 5 → stable.
      const r = trendDirection({
        currentWait: 30,
        recentWait: 10,
        bucket1Wait: 24,
        bucket3Wait: 25,
        bucket4Wait: 28,
      });
      expect(r).toBe('stable');
    });
  });

  describe('mid-curve peak — known limitation', () => {
    it("smooth peak (60 → 90 → 90 → 60 → 60) reads 'down' because avg-of-late < avg-of-early", () => {
      // earlyAvg = avg(60, 90) = 75. lateAvg = avg(60, 60) = 60. future = -15.
      // past = 0. Total = -15 → 'down'.
      // Documents the known limitation: a single-direction summary can't express
      // "rises then falls" — the late window wins because that's where we end up.
      const r = trendDirection({
        currentWait: 60,
        recentWait: 60,
        bucket1Wait: 90,
        bucket3Wait: 60,
        bucket4Wait: 60,
      });
      expect(r).toBe('down');
    });
  });
});
