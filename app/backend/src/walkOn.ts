// Disney posts wait times in multiples of 5. Any other value is a deliberate
// walk-on marker rather than a literal wait — Haunted Mansion's thematic 13 is
// the main one, at 24% of its readings (also HM Holiday and both Guardians
// overlays).
//
// This is for COMPARISON ONLY. The raw posted value is what the app displays;
// normalizing it on screen would show "5 min" where Disney shows "13 min".
// Scoring has to normalize because the model and the ride_stats percentiles are
// both built on normalized values — comparing a raw 13 against a normalized p10
// of 5 would silently kill the star verdict on a genuine walk-on.
//
// Must match cron/predict.py::_normalize_walk_on and the notebook's
// walk-on-normalization cell.
// Bounded to the walk-on regime on purpose. A marker means "essentially no
// wait", so it is always small — 13 is the only off-grid value in 744k rows of
// DLR data. An off-grid 36 or 62 is a real wait, and collapsing it to 5 would be
// a catastrophic misread, so the rule must never reach that far.
const WALK_ON_MAX = 15;

export function normalizeWalkOn(wait: number | null): number | null {
  if (wait == null) return null;
  // Genuine zeros pass through, since 0 % 5 === 0.
  return wait % 5 !== 0 && wait < WALK_ON_MAX ? 5 : wait;
}
