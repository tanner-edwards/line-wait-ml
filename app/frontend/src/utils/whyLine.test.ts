import { whyLine } from './whyLine';
import { VerdictReason, VerdictReasons } from '../types';

// Minimal reasons object with a given primary; betterWindowInMin drives the
// "when" clause for the relief-skip lines.
function reasons(primary: VerdictReason, betterWindowInMin: number | null = 120): VerdictReasons {
  return {
    primary, current: 0, typical: null, todayP30: null, todayP80: null,
    p10: null, p90: null, beatableSoon: false, betterWindowWait: null,
    betterWindowInMin, star: false,
  };
}

describe('whyLine', () => {
  it('returns a line for each surfaced reason', () => {
    const surfaced: VerdictReason[] = [
      'rare-low', 'todays-low', 'below-usual', 'at-ceiling', 'high-vs-usual', 'dropping-soon', 'busy-no-relief',
    ];
    for (const r of surfaced) {
      expect(whyLine(reasons(r), 'ride-1')).toBeTruthy();
    }
  });

  it('returns null for reasons we deliberately do not surface', () => {
    const silent: VerdictReason[] = ['filler', 'trivial-drop', 'short-to-skip', 'none'];
    for (const r of silent) {
      expect(whyLine(reasons(r), 'ride-1')).toBeNull();
    }
  });

  it('surfaces the "when" (time-until) but never a wait figure', () => {
    // 120 min → "~2h", 30 min → "~30 min"; no wait-minute numbers in the copy.
    expect(whyLine(reasons('at-ceiling', 120), 'ride-1')).toMatch(/~2h/);
    expect(whyLine(reasons('high-vs-usual', 30), 'ride-1')).toMatch(/~30 min/);
  });

  it('is stable for a given rideId but can vary across rides', () => {
    const a = whyLine(reasons('rare-low'), 'ride-A');
    expect(whyLine(reasons('rare-low'), 'ride-A')).toBe(a); // deterministic per ride
  });

  it('has no em-dashes (avoids the AI tell)', () => {
    const all: VerdictReason[] = ['rare-low', 'todays-low', 'below-usual', 'at-ceiling', 'high-vs-usual', 'dropping-soon', 'busy-no-relief'];
    for (const r of all) {
      for (const id of ['a', 'bb', 'ccc']) {  // exercise both phrasing picks
        expect(whyLine(reasons(r), id)).not.toContain('—');
      }
    }
  });
});
