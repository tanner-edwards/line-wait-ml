// Firestore write helper for the beta feedback form (`feedback` collection).

import { getFirestore } from './firestoreClient';
import { FeedbackRecord } from './types';

export async function submitFeedback(
  userId: string,
  fields: Omit<FeedbackRecord, 'userId' | 'timestamp' | 'appVersion'>,
  appVersion: string | null = null
): Promise<void> {
  const db = getFirestore();
  const record: FeedbackRecord = {
    userId,
    timestamp: new Date().toISOString(),
    appVersion,
    ...fields,
  };
  await db.collection('feedback').add(record);
}
