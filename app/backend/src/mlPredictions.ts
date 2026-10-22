import { getFirestore } from './firestoreClient';

export interface MLPredictionDoc {
  ride_id: string;
  updated_at: string;
  t10: number;
  t20: number;
  t30: number;
  t40: number;
  t50: number;
  t60: number;
  t90: number;
  t120: number;
  t150: number;
  t180: number;
  t210: number;
  t240: number;
  trend: string;
  // t30 − current. No longer the source of `trend` (Session 5); delete once no
  // supported app version reads it.
  trend_delta_30: number;
  confidence: string;        // describes the trend word (classifier-derived since Session 5)
  curve_confidence?: string;  // vote-count agreement of the trajectory curve; gates layer1's use of t10..t240
  full_day: Array<{ time_slot: string; start_minutes: number; wait: number }>;
  // Direction classifiers (Session 5): P(wait falls / rises by the model's
  // label, e.g. ≥5 min, within 30 / 60 min). Absent on docs from older models.
  p_fall_30?: number;
  p_fall_60?: number;
  p_rise_30?: number;
  p_rise_60?: number;
  trend_source?: 'classifier' | 'regression';  // what `trend` / `confidence` were derived from
  degraded?: boolean;       // tombstone: predict.py couldn't forecast this ride this run
  degraded_reason?: string;
  model_version?: string;   // trained_through date of the model that wrote the doc
}

// Far-away downgrade (handler.ts): go/star → neutral when p_rise_30 is at or
// above this, the current wait is above ALERT_MIN_CURRENT_WAIT, and the user is
// more than 15 walking minutes away. The number is the Session 5 experiment's
// alert pick (reports/eval/2026-10-21_session5-classifiers.md, 2026-10-21); the
// models' manifest.json `alert.threshold` is the source of truth and
// handler.alert.test.ts pins this constant to a copy of it.
export const P_RISE_ALERT_THRESHOLD = 0.5;
// Never fire at current ≤ 10: a 5 → 10 move is noise to a walking guest.
export const ALERT_MIN_CURRENT_WAIT = 10;

// predict.py runs every 10 min; a doc older than this means the ride was
// skipped (or the job failed) and its forecast must not be served as live.
export const PREDICTION_MAX_AGE_MINUTES = 20;

// The first field a doc lacks that buildPrediction / buildFullDayForecast read
// unconditionally, or null when the doc is safe to serve. Guards against
// bare tombstones and any future shape drift between predict.py and here.
export function missingPredictionField(doc: unknown): string | null {
  if (doc === null || typeof doc !== 'object') return 'doc';
  const d = doc as Record<string, unknown>;
  if (typeof d.t30 !== 'number') return 't30';
  if (typeof d.trend !== 'string') return 'trend';
  if (typeof d.confidence !== 'string') return 'confidence';
  if (!Array.isArray(d.full_day)) return 'full_day';
  return null;
}

export function isUsablePrediction(doc: unknown): doc is MLPredictionDoc {
  return missingPredictionField(doc) === null;
}

// Rides with no usable doc (tombstoned, stale, missing updated_at, or missing
// a required field) are left out of the map, so callers fall back exactly as
// for a ride with no doc.
export async function loadPredictions(
  now: Date = new Date(),
  maxAgeMinutes = PREDICTION_MAX_AGE_MINUTES,
): Promise<Map<string, MLPredictionDoc>> {
  const db = getFirestore();
  const snap = await db.collection('predictions').get();
  const map = new Map<string, MLPredictionDoc>();
  for (const doc of snap.docs) {
    const data = doc.data() as MLPredictionDoc;
    if (data.degraded === true) continue;
    const updatedMs = data.updated_at ? Date.parse(data.updated_at) : NaN;
    if (Number.isNaN(updatedMs)) continue;
    if (now.getTime() - updatedMs > maxAgeMinutes * 60_000) continue;
    const missing = missingPredictionField(data);
    if (missing !== null) {
      console.warn(`predictions/${doc.id}: unusable doc (missing ${missing}); serving without ML`);
      continue;
    }
    map.set(doc.id, data);
  }
  return map;
}
