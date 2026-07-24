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
}

export async function loadPredictions(): Promise<Map<string, MLPredictionDoc>> {
  const db = getFirestore();
  const snap = await db.collection('predictions').get();
  const map = new Map<string, MLPredictionDoc>();
  for (const doc of snap.docs) {
    map.set(doc.id, doc.data() as MLPredictionDoc);
  }
  return map;
}
