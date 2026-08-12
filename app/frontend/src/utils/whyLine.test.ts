import { whyLine } from './whyLine';
import { VerdictReason } from '../types';

describe('whyLine', () => {
  it('returns a line for each surfaced reason', () => {
    const surfaced: VerdictReason[] = [
      'rare-low', 'todays-low', 'below-usual', 'at-ceiling', 'high-vs-usual', 'dropping-soon', 'high-but-steady',
    ];
    for (const r of surfaced) {
      expect(whyLine(r)).toBeTruthy();
    }
  });

  it('returns null for reasons we deliberately do not surface', () => {
    const silent: VerdictReason[] = ['filler', 'trivial-drop', 'short-to-skip', 'none'];
    for (const r of silent) {
      expect(whyLine(r)).toBeNull();
    }
  });

  it('uses forward-looking copy for the confusing high-but-steady neutral', () => {
    expect(whyLine('high-but-steady')).toBe("High now, and it stays busy — the lulls don't come till late");
  });
});
