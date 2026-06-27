import { getFirestore } from './firestoreClient';

export interface ClosureProfile {
  rideId: string;
  rideName: string;
  sampleCount: number;
  shortResetThresholdMin: number;
  p50Min: number;
  p75Min: number;
  p90Min: number;
  extendedSampleCount: number;
  extendedP50Min: number | null;
  extendedP75Min: number | null;
  extendedMedianDelta: number | null;
  updatedAt: string;
}

export async function loadClosureProfiles(): Promise<Map<string, ClosureProfile>> {
  const db = getFirestore();
  const snap = await db.collection('closure_profiles').get();
  const map = new Map<string, ClosureProfile>();
  for (const doc of snap.docs) {
    map.set(doc.id, doc.data() as ClosureProfile);
  }
  return map;
}
