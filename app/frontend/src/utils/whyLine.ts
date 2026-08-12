import { VerdictReason } from '../types';

// Deterministic "why this recommendation" copy. Keyed off the backend-generated
// `primary` reason, so the line can never contradict the badge — both derive
// from the same numbers. Forward-looking voice (Club 32 is predictive, not
// reactive). Returns null for reasons we deliberately don't surface (a plain
// neutral ride has no call to explain).
//
// Only these reasons show a line; everything else (filler / trivial-drop /
// short-to-skip / none) returns null and the "?" trigger is hidden.
export function whyLine(primary: VerdictReason): string | null {
  // Text-only, no numbers. The timing words ("soon", "till late") are earned by
  // the data — a skip only fires when a better window is actually reachable soon;
  // high-but-steady fires precisely because the lows aren't reachable until late.
  switch (primary) {
    case 'rare-low':        return 'This is as low as this ride ever gets';
    case 'todays-low':      return "About the lowest it'll be the rest of today";
    case 'below-usual':     return 'Shorter than it usually runs right now';
    case 'at-ceiling':      return 'About as busy as it gets — a shorter window opens up soon';
    case 'high-vs-usual':   return 'Busier than usual right now — it eases off soon';
    case 'dropping-soon':   return "It's about to drop — worth waiting for";
    case 'high-but-steady': return "High now, and it stays busy — the lulls don't come till late";
    default:                return null;
  }
}
