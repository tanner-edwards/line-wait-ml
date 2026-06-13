import {
  computeLayout,
  FLOAT_PAD,
  PAD_NORMAL,
  TR_W,
  LABEL_Y,
  TR_H,
} from './TodaysRange';

// Convenience: innerRight when right side uses normal padding.
const RIGHT_NORMAL = TR_W - PAD_NORMAL;
// Convenience: innerRight when right side uses float padding.
const RIGHT_FLOAT  = TR_W - FLOAT_PAD;

describe('computeLayout — padding expansion', () => {
  it('uses PAD_NORMAL on both sides when everything is in range', () => {
    const l = computeLayout(10, 50, 30, 25);
    expect(l.innerLeft).toBe(PAD_NORMAL);
    expect(l.innerRight).toBe(RIGHT_NORMAL);
  });

  it('expands left padding when current < p10', () => {
    const l = computeLayout(20, 60, 5, null);
    expect(l.innerLeft).toBe(FLOAT_PAD);
    expect(l.innerRight).toBe(RIGHT_NORMAL);
  });

  it('expands right padding when current > p90', () => {
    const l = computeLayout(20, 60, 80, null);
    expect(l.innerLeft).toBe(PAD_NORMAL);
    expect(l.innerRight).toBe(RIGHT_FLOAT);
  });

  it('expands left padding when typical < p10 (even if current is in range)', () => {
    const l = computeLayout(20, 60, 30, 5);
    expect(l.innerLeft).toBe(FLOAT_PAD);
    expect(l.innerRight).toBe(RIGHT_NORMAL);
  });

  it('expands right padding when typical > p90 (even if current is in range)', () => {
    const l = computeLayout(20, 60, 30, 80);
    expect(l.innerLeft).toBe(PAD_NORMAL);
    expect(l.innerRight).toBe(RIGHT_FLOAT);
  });

  it('expands both sides when current is below p10 AND typical is above p90', () => {
    const l = computeLayout(20, 60, 5, 80);
    expect(l.innerLeft).toBe(FLOAT_PAD);
    expect(l.innerRight).toBe(RIGHT_FLOAT);
  });

  it('uses PAD_NORMAL when current is exactly at p10 (on the boundary, not floating)', () => {
    const l = computeLayout(20, 60, 20, null);
    expect(l.innerLeft).toBe(PAD_NORMAL);
    expect(l.dotFloatingLeft).toBe(false);
  });

  it('uses PAD_NORMAL when current is exactly at p90', () => {
    const l = computeLayout(20, 60, 60, null);
    expect(l.innerRight).toBe(RIGHT_NORMAL);
    expect(l.dotFloatingRight).toBe(false);
  });
});

describe('computeLayout — dot position and floating flags', () => {
  it('dot at left edge of track when current = p10', () => {
    const l = computeLayout(20, 60, 20, null);
    expect(l.dotX).toBe(l.innerLeft);
    expect(l.dotFloatingLeft).toBe(false);
    expect(l.dotFloatingRight).toBe(false);
  });

  it('dot at right edge of track when current = p90', () => {
    const l = computeLayout(20, 60, 60, null);
    expect(l.dotX).toBe(l.innerRight);
    expect(l.dotFloatingLeft).toBe(false);
    expect(l.dotFloatingRight).toBe(false);
  });

  it('dot at midpoint when current is exactly midrange', () => {
    const l = computeLayout(20, 60, 40, null);
    expect(l.dotX).toBe(l.innerLeft + l.totalW / 2);
    expect(l.dotFloatingLeft).toBe(false);
    expect(l.dotFloatingRight).toBe(false);
  });

  it('dotFloatingLeft=true and dotX < innerLeft when current < p10', () => {
    const l = computeLayout(20, 60, 5, null);
    expect(l.dotFloatingLeft).toBe(true);
    expect(l.dotFloatingRight).toBe(false);
    expect(l.dotX).not.toBeNull();
    expect(l.dotX!).toBeLessThan(l.innerLeft);
  });

  it('dotFloatingRight=true and dotX > innerRight when current > p90', () => {
    const l = computeLayout(20, 60, 80, null);
    expect(l.dotFloatingRight).toBe(true);
    expect(l.dotFloatingLeft).toBe(false);
    expect(l.dotX).not.toBeNull();
    expect(l.dotX!).toBeGreaterThan(l.innerRight);
  });

  it('dot is null when current is null', () => {
    const l = computeLayout(20, 60, null, null);
    expect(l.dotX).toBeNull();
    expect(l.dotFloatingLeft).toBe(false);
    expect(l.dotFloatingRight).toBe(false);
  });

  it('dot clamped to SVG left edge (r=7) for extreme out-of-bounds low', () => {
    // current = -100, way below p10=20 — raw position would be very negative
    const l = computeLayout(20, 60, -100, null);
    expect(l.dotX).toBe(7);
  });

  it('dot clamped to SVG right edge (TR_W-7) for extreme out-of-bounds high', () => {
    const l = computeLayout(20, 60, 500, null);
    expect(l.dotX).toBe(TR_W - 7);
  });

  it('proportional: farther below p10 → dotX further left', () => {
    const far  = computeLayout(20, 60, 5,  null);
    const near = computeLayout(20, 60, 15, null);
    expect(far.dotX!).toBeLessThan(near.dotX!);
  });

  it('proportional: farther above p90 → dotX further right', () => {
    const near = computeLayout(20, 60, 65, null);
    const far  = computeLayout(20, 60, 80, null);
    expect(far.dotX!).toBeGreaterThan(near.dotX!);
  });
});

describe('computeLayout — typical marker', () => {
  it('typicalInBounds=true when typical is inside P10–P90', () => {
    const l = computeLayout(20, 60, 30, 35);
    expect(l.typicalInBounds).toBe(true);
    expect(l.typicalX).not.toBeNull();
  });

  it('typicalInBounds=false when typical < p10', () => {
    const l = computeLayout(20, 60, 30, 10);
    expect(l.typicalInBounds).toBe(false);
    expect(l.typicalX!).toBeLessThan(l.innerLeft);
  });

  it('typicalInBounds=false when typical > p90', () => {
    const l = computeLayout(20, 60, 30, 70);
    expect(l.typicalInBounds).toBe(false);
    expect(l.typicalX!).toBeGreaterThan(l.innerRight);
  });

  it('typicalX is null when typicalWait is null', () => {
    const l = computeLayout(20, 60, 30, null);
    expect(l.typicalX).toBeNull();
    expect(l.typicalLabelX).toBeNull();
  });
});

describe('computeLayout — typical label drop (proximity)', () => {
  it('label stays at LABEL_Y when typical is well away from both endpoints', () => {
    // typical at midpoint — no crowding
    const l = computeLayout(20, 60, 30, 40);
    expect(l.typicalLabelY).toBe(LABEL_Y);
    expect(l.svgH).toBe(TR_H);
  });

  it('label drops when typical crowds the p10 endpoint', () => {
    // typical=22 is close to p10=20, so typicalLabelX ≈ innerLeft, crowded
    const l = computeLayout(20, 60, 30, 22);
    expect(l.typicalLabelY).toBe(LABEL_Y + 14);
    expect(l.svgH).toBe(TR_H + 14);
  });

  it('label drops when typical crowds the p90 endpoint', () => {
    const l = computeLayout(20, 60, 30, 58);
    expect(l.typicalLabelY).toBe(LABEL_Y + 14);
    expect(l.svgH).toBe(TR_H + 14);
  });

  it('no drop when typical is floating left of track (gap already separates labels)', () => {
    const l = computeLayout(20, 60, 30, 5);
    expect(l.typicalLabelY).toBe(LABEL_Y);
  });

  it('no drop when typical is floating right of track', () => {
    const l = computeLayout(20, 60, 30, 80);
    expect(l.typicalLabelY).toBe(LABEL_Y);
  });
});
