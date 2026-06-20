// Firestore read/write helpers for the `users` and `trips` collections.
// All functions assume the caller has already verified the Firebase ID token
// and extracted a valid uid.

import { getFirestore } from './firestoreClient';
import { TripRecord, UserRecord, UserResponse } from './types';

export async function upsertUser(
  uid: string,
  appleId: string,
  email: string | null
): Promise<{ record: UserRecord; isNew: boolean }> {
  const db = getFirestore();
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();

  if (snap.exists) {
    return { record: snap.data() as UserRecord, isNew: false };
  }

  const record: UserRecord = {
    userId: uid,
    appleId,
    email,
    createdAt: new Date().toISOString(),
    freeTripClaimed: false,
    bypass: false,
  };
  await ref.set(record);
  return { record, isNew: true };
}

export async function getUser(uid: string): Promise<UserRecord | null> {
  const db = getFirestore();
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? (snap.data() as UserRecord) : null;
}

export async function getTrip(uid: string): Promise<TripRecord | null> {
  const db = getFirestore();
  const snap = await db.collection('trips').doc(uid).get();
  return snap.exists ? (snap.data() as TripRecord) : null;
}

export async function deleteUserData(uid: string): Promise<void> {
  const db = getFirestore();
  const batch = db.batch();

  batch.delete(db.collection('users').doc(uid));
  batch.delete(db.collection('trips').doc(uid));

  // Remove device records linked to this user. Devices that were registered
  // anonymously (no userId field) are left alone — they won't receive auth-
  // gated notifications after the user deletes their account.
  const devicesSnap = await db.collection('devices').where('userId', '==', uid).get();
  devicesSnap.docs.forEach(doc => batch.delete(doc.ref));

  await batch.commit();
}

export async function buildUserResponse(
  uid: string,
  appleId: string,
  email: string | null,
  isNew: boolean
): Promise<UserResponse> {
  const [userResult, trip] = await Promise.all([
    isNew
      ? upsertUser(uid, appleId, email).then(r => r.record)
      : getUser(uid),
    getTrip(uid),
  ]);

  const record = userResult ?? {
    userId: uid,
    appleId,
    email,
    createdAt: new Date().toISOString(),
    freeTripClaimed: false,
    bypass: false,
  };

  return {
    userId: uid,
    freeTripClaimed: record.freeTripClaimed,
    bypass: record.bypass,
    isNew,
    trip,
  };
}
