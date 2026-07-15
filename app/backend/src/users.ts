// Firestore read/write helpers for the `users` and `trips` collections.
// All functions assume the caller has already verified the Firebase ID token
// and extracted a valid uid.

import { getFirestore } from './firestoreClient';
import { PromoCode, TripRecord, UserRecord, UserResponse } from './types';

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
  const snap = await db.collection('trips')
    .where('uid', '==', uid)
    .orderBy('purchasedAt', 'desc')
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0].data() as TripRecord);
}

export async function deleteUserData(uid: string): Promise<void> {
  const db = getFirestore();
  const batch = db.batch();

  batch.delete(db.collection('users').doc(uid));

  // Delete all trip records for this user.
  const tripsSnap = await db.collection('trips').where('uid', '==', uid).get();
  tripsSnap.docs.forEach(doc => batch.delete(doc.ref));

  // Remove device records linked to this user. Devices that were registered
  // anonymously (no userId field) are left alone — they won't receive auth-
  // gated notifications after the user deletes their account.
  const devicesSnap = await db.collection('devices').where('userId', '==', uid).get();
  devicesSnap.docs.forEach(doc => batch.delete(doc.ref));

  await batch.commit();
}

export async function claimFreeTrip(
  uid: string,
  appleId: string,
  tripStart: string,
  tripEnd: string
): Promise<TripRecord> {
  const db = getFirestore();
  const userRef = db.collection('users').doc(uid);
  const claimedRef = db.collection('claimedFreeTrips').doc(appleId);

  // Check both the user record AND the durable appleId ledger. The user record
  // is deleted on account deletion, so it alone can't prevent re-claim after
  // a delete + re-signup with the same Apple ID.
  const [userSnap, claimedSnap] = await Promise.all([userRef.get(), claimedRef.get()]);

  if (!userSnap.exists) throw new Error('User not found');
  if (claimedSnap.exists) throw new Error('Free trip already claimed');
  const user = userSnap.data() as UserRecord;
  if (user.freeTripClaimed) throw new Error('Free trip already claimed');

  const trip: TripRecord = {
    uid,
    tripStart,
    tripEnd,
    purchasedAt: new Date().toISOString(),
    source: 'free',
  };

  const batch = db.batch();
  batch.set(db.collection('trips').doc(), trip);
  batch.update(userRef, { freeTripClaimed: true });
  // Write the durable ledger entry — survives account deletion.
  batch.set(claimedRef, { uid, claimedAt: new Date().toISOString() });
  await batch.commit();

  return trip;
}

// Read-only validation — checks the code is valid without claiming it or
// incrementing timesUsed. Used by the "Apply" step in the paywall UI.
export async function checkPromoCode(code: string): Promise<void> {
  const db = getFirestore();
  const normalizedCode = code.trim().toUpperCase();
  const codeSnap = await db.collection('promoCodes').doc(normalizedCode).get();

  if (!codeSnap.exists) throw new Error('Invalid promo code');
  const promo = codeSnap.data() as PromoCode;

  if (!promo.active) throw new Error('This code is no longer active');
  if (new Date(promo.expiresAt) < new Date()) throw new Error('This code has expired');
  if (promo.timesUsed >= promo.maxUses) throw new Error('This code has been fully redeemed');
}

export async function validatePromoCode(
  uid: string,
  code: string,
  tripStart: string,
  tripEnd: string
): Promise<TripRecord> {
  const db = getFirestore();
  const normalizedCode = code.trim().toUpperCase();
  const codeRef = db.collection('promoCodes').doc(normalizedCode);
  const codeSnap = await codeRef.get();

  if (!codeSnap.exists) throw new Error('Invalid promo code');
  const promo = codeSnap.data() as PromoCode;

  if (!promo.active) throw new Error('This code is no longer active');
  if (new Date(promo.expiresAt) < new Date()) throw new Error('This code has expired');
  if (promo.timesUsed >= promo.maxUses) throw new Error('This code has been fully redeemed');

  // Per-user guard — prevent the same user from redeeming the same code twice.
  const existingSnap = await db.collection('trips')
    .where('uid', '==', uid)
    .where('promoCode', '==', normalizedCode)
    .limit(1)
    .get();
  if (!existingSnap.empty) throw new Error('You have already used this promo code');

  const trip: TripRecord = {
    uid,
    tripStart,
    tripEnd,
    purchasedAt: new Date().toISOString(),
    source: 'promo',
    promoCode: normalizedCode,
  };

  const batch = db.batch();
  batch.set(db.collection('trips').doc(), trip);
  batch.update(codeRef, { timesUsed: promo.timesUsed + 1 });
  await batch.commit();

  return trip;
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
