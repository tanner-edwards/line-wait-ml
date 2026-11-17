// Recently-reopened rides, for the recommendations prompt (spec 6.6).
//
// scanner.js appends one closure_events doc per closure when the ride comes
// back, with `reopenedAt` as an ISO string. A posted wait right after a reopen
// can lag the real line, so the model is told how long ago each ride reopened.
//
// One bounded single-field range query per recommendations call (no composite
// index). Best-effort: any failure returns an empty map.

import { getFirestore } from './firestoreClient';
import { REOPEN_WINDOW_MIN } from './recommendations/promptInputs';

/** rideId → whole minutes since the most recent reopen within REOPEN_WINDOW_MIN. */
export async function loadRecentReopens(now: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const since = new Date(now.getTime() - REOPEN_WINDOW_MIN * 60_000).toISOString();
    const snap = await getFirestore()
      .collection('closure_events')
      .where('reopenedAt', '>=', since)
      .get();
    snap.forEach(doc => {
      const d = doc.data() as { rideId?: unknown; reopenedAt?: unknown };
      if (typeof d.rideId !== 'string' || typeof d.reopenedAt !== 'string') return;
      const t = Date.parse(d.reopenedAt);
      if (Number.isNaN(t)) return;
      // The range query has no upper bound; for a time-travel `now` (?at=)
      // later reopens come back too. Allow a minute of clock skew.
      if (t > now.getTime() + 60_000) return;
      const minutesAgo = Math.max(0, Math.round((now.getTime() - t) / 60_000));
      if (minutesAgo > REOPEN_WINDOW_MIN) return;
      const prev = out.get(d.rideId);
      if (prev === undefined || minutesAgo < prev) out.set(d.rideId, minutesAgo);
    });
  } catch (err) {
    console.warn('closure_events read failed; serving without reopen signal', err);
    return new Map();
  }
  return out;
}
