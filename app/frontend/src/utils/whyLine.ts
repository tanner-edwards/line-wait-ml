import { VerdictReason, VerdictReasons } from '../types';

// Deterministic "why this recommendation" copy for the ride-detail ReasonCard.
// Keyed off the backend-generated `primary` reason, so it can never contradict
// the badge. Forward-looking, text-only for WAIT values (never a minute figure),
// but the "when" (time until the wait changes) IS surfaced — it's a time-until,
// not a wait promise. Returns null for reasons we don't surface (a plain neutral
// ride has nothing to explain).

// The "when" clause from minutes-until-the-better-window. A time, never a wait.
function whenClause(min: number | null): string {
  if (min == null) return 'soon';
  if (min < 90) return `in ~${Math.max(15, Math.round(min / 15) * 15)} min`;
  const h = Math.round(min / 30) / 2; // nearest half hour
  return `in ~${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

// Stable phrasing pick: hash the rideId so a given ride always reads the same
// line (no flicker), but different rides vary. (Runtime blocks RNG anyway.)
function pick(options: string[], rideId: string): string {
  let h = 0;
  for (let i = 0; i < rideId.length; i++) h = (h * 31 + rideId.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}

export function whyLine(reasons: VerdictReasons, rideId: string): string | null {
  const when = whenClause(reasons.betterWindowInMin);
  const V: Partial<Record<VerdictReason, string[]>> = {
    'rare-low': [
      'This is as low as this ride ever gets',
      "A rare low. It won't be shorter than this",
    ],
    'todays-low': [
      "About the lowest it'll be the rest of today",
      'The best window left today',
    ],
    'below-usual': [
      'Lighter than usual right now',
      'Shorter than its normal for this hour',
    ],
    'at-ceiling': [
      `About as busy as it gets. Eases ${when}`,
      `At its peak now. A shorter window opens ${when}`,
    ],
    'high-vs-usual': [
      `Busier than usual. Eases off ${when}`,
      `Above its usual, with a better window ${when}`,
    ],
    'dropping-soon': [
      `Dropping to a much shorter wait ${when}`,
      `About to fall off ${when}. Worth holding for`,
    ],
    'busy-no-relief': [
      'Busier than usual, with no relief the rest of today',
      "About as busy as it gets, and it's holding all day",
    ],
  };
  const opts = V[reasons.primary];
  return opts ? pick(opts, rideId) : null;
}
