import { haversineMeters, walkingMinutes, walkingYards } from './walkingDistance';

// Reference coords from ride_metadata.json:
//   Indiana Jones     33.8108, -117.9215  (Adventureland)
//   Big Thunder       33.8128, -117.9224  (Frontierland — adjacent)
//   Hyperspace Mtn    33.8125, -117.9176  (Tomorrowland — across park)
//   Winnie the Pooh   33.8143, -117.9197  (Fantasyland)
//
// Tiered path multiplier (applied to straight-line haversine distance):
//   < 366 m  → 1.3×   same land / adjacent
//   366–640m → 1.6×   cross-land trek
//   640+ m   → 2.0×   full park crossing

describe('haversineMeters', () => {
  it('returns 0 for the same point', () => {
    expect(haversineMeters(33.81, -117.92, 33.81, -117.92)).toBe(0);
  });

  it('returns a small positive value for adjacent rides', () => {
    // Indiana Jones → Big Thunder, both in central DL
    const d = haversineMeters(33.8108, -117.9215, 33.8128, -117.9224);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(500); // under 500m straight-line
  });

  it('returns a larger value for across-park rides', () => {
    // Indiana Jones (Adventureland) → Hyperspace Mountain (Tomorrowland)
    const d = haversineMeters(33.8108, -117.9215, 33.8125, -117.9176);
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(700);
  });
});

describe('walkingMinutes', () => {
  it('returns null when `from` has missing coordinates', () => {
    expect(walkingMinutes({ lat: null, lng: -117.92 }, { lat: 33.81, lng: -117.92 })).toBeNull();
    expect(walkingMinutes({ lat: 33.81, lng: null }, { lat: 33.81, lng: -117.92 })).toBeNull();
  });

  it('returns null when `to` has missing coordinates', () => {
    expect(walkingMinutes({ lat: 33.81, lng: -117.92 }, { lat: null, lng: -117.92 })).toBeNull();
  });

  it('returns null when either side is null', () => {
    expect(walkingMinutes(null, { lat: 33.81, lng: -117.92 })).toBeNull();
    expect(walkingMinutes({ lat: 33.81, lng: -117.92 }, null)).toBeNull();
  });

  it('floors at 1 minute even for identical coordinates', () => {
    const w = walkingMinutes({ lat: 33.81, lng: -117.92 }, { lat: 33.81, lng: -117.92 });
    expect(w).toBe(1);
  });

  it('returns a few minutes for nearby rides (adjacent in same land)', () => {
    // Indiana Jones → Big Thunder (~200-300m straight line × 1.3 / 80.5 m/min)
    const w = walkingMinutes(
      { lat: 33.8108, lng: -117.9215 },
      { lat: 33.8128, lng: -117.9224 }
    )!;
    expect(w).toBeGreaterThanOrEqual(1);
    expect(w).toBeLessThanOrEqual(5);
  });

  it('returns more minutes for across-park rides (2.0× tier)', () => {
    // Indiana Jones (Adventureland) → Hyperspace Mountain (Tomorrowland)
    // haversine ~370m → above both thresholds, 2.0× multiplier → ~9 min
    const w = walkingMinutes(
      { lat: 33.8108, lng: -117.9215 },
      { lat: 33.8125, lng: -117.9176 }
    )!;
    expect(w).toBeGreaterThanOrEqual(8);
    expect(w).toBeLessThanOrEqual(15);
  });

  it('applies a heavier multiplier for long walks than short ones proportionally', () => {
    // Construct two walks with the same raw haversine distance but falling in
    // different tiers, by using coordinates that straddle the 640m threshold.
    //
    // Short: two points ~200m apart → 1.3× tier → path = 260m → ~3 min
    // Long:  two points ~700m apart → 2.0× tier → path = 1400m → ~17 min
    // If the multiplier were flat 1.3, long/short ratio would mirror the raw
    // distance ratio (~3.5×). With 2.0× vs 1.3×, the long walk is penalized
    // ~1.54× harder per metre, so the time ratio should be higher than 3.5×.

    const shortWalk = walkingMinutes(
      { lat: 33.8120, lng: -117.9200 },
      { lat: 33.8138, lng: -117.9200 }, // ~200m north
    )!;
    const longWalk = walkingMinutes(
      { lat: 33.8120, lng: -117.9200 },
      { lat: 33.8183, lng: -117.9200 }, // ~700m north
    )!;
    // Long walk's per-metre penalty is heavier, so ratio should exceed raw distance ratio
    const rawRatio = 700 / 200;
    expect(longWalk / shortWalk).toBeGreaterThan(rawRatio);
  });

  it('is symmetric (from↔to swap returns the same minutes)', () => {
    const a = { lat: 33.8108, lng: -117.9215 };
    const b = { lat: 33.8125, lng: -117.9176 };
    expect(walkingMinutes(a, b)).toBe(walkingMinutes(b, a));
  });
});

describe('walkingYards', () => {
  it('returns null when coords are missing on either side', () => {
    expect(walkingYards(null, { lat: 33.81, lng: -117.92 })).toBeNull();
    expect(walkingYards({ lat: null, lng: -117.92 }, { lat: 33.81, lng: -117.92 })).toBeNull();
  });

  it('floors at 1 yard for identical coordinates', () => {
    expect(walkingYards({ lat: 33.81, lng: -117.92 }, { lat: 33.81, lng: -117.92 })).toBe(1);
  });

  it('returns a reasonable yard count for nearby rides', () => {
    // Indiana Jones → Big Thunder (~200-300m straight × 1.3 × 1.09yd/m)
    const y = walkingYards(
      { lat: 33.8108, lng: -117.9215 },
      { lat: 33.8128, lng: -117.9224 }
    )!;
    expect(y).toBeGreaterThan(100);
    expect(y).toBeLessThan(500);
  });
});
