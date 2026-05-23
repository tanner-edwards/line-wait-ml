import { haversineMeters, walkingMinutes } from './walkingDistance';

// Reference: Indiana Jones (33.8108, -117.9215) and Big Thunder (33.8128, -117.9224)
// are next door. Hyperspace Mountain (33.8125, -117.9176) is across the park.
// Numbers below come from coordinates in ride_metadata.json.

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

  it('returns more minutes for across-park rides', () => {
    // Indiana Jones (Adventureland) → Hyperspace Mountain (Tomorrowland)
    const w = walkingMinutes(
      { lat: 33.8108, lng: -117.9215 },
      { lat: 33.8125, lng: -117.9176 }
    )!;
    expect(w).toBeGreaterThanOrEqual(5);
    expect(w).toBeLessThanOrEqual(15);
  });

  it('is symmetric (from↔to swap returns the same minutes)', () => {
    const a = { lat: 33.8108, lng: -117.9215 };
    const b = { lat: 33.8125, lng: -117.9176 };
    expect(walkingMinutes(a, b)).toBe(walkingMinutes(b, a));
  });
});
