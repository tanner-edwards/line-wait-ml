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
  trend_delta_30: number;
  confidence: string;
  full_day: Array<{ time_slot: string; start_minutes: number; wait: number }>;
  reversion_prob?: number;  // P(wait spikes ≥40% within 30 min)
  pct_rank?: number;        // empirical percentile within ride's own hour/day-type bucket
  degraded?: boolean;       // tombstone: predict.py couldn't forecast this ride this run
  degraded_reason?: string;
  model_version?: string;   // trained_through date of the model that wrote the doc
}

// predict.py runs every 10 min; a doc older than this means the ride was
// skipped (or the job failed) and its forecast must not be served as live.
export const PREDICTION_MAX_AGE_MINUTES = 20;

// Rides with no usable doc (tombstoned, stale, or missing updated_at) are left
// out of the map, so callers fall back exactly as for a ride with no doc.
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
    map.set(doc.id, data);
  }
  return map;
}
