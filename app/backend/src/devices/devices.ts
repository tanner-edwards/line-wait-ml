// Firestore data layer for the `devices` collection — one document per
// anonymous device that has interacted with notifications. The Lambda
// endpoints under /v1/devices/* mutate this collection; the scanner
// (see scanner.js at repo root, Phase B) reads from it to decide who
// to push to.

import { getFirestore } from '../firestoreClient';

const COLLECTION = 'devices';

export type PushTokenType = 'web' | 'expo';
export type DailyParks = 'disneyland' | 'california-adventure' | 'both';
export const DAILY_PARKS_VALUES: readonly DailyParks[] = ['disneyland', 'california-adventure', 'both'];

export type NotificationKind = 'trough' | 'closure' | 'reopen' | 'peak';
export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['trough', 'closure', 'reopen', 'peak'];

export type NotificationTypes = Record<NotificationKind, boolean>;

export interface DeviceRecord {
  deviceId: string;
  // Firebase uid of the account this device last registered under (real or
  // anonymous). Links this device-scoped record to the uid-scoped `trips`
  // collection so a new trip can reset retiredRideIds server-side. Null for
  // devices that registered before this field existed, or that never sent one.
  uid: string | null;
  pushToken: string | null;
  pushTokenType: PushTokenType | null;
  mustDoRideIds: string[];
  // Rides swiped "Rode it" — excluded from recs for the rest of the trip.
  // Unlike mustDoRideIds, this resets (see resetRetiredRideIdsForUid) when
  // the uid's active trip changes. Client is the primary source of truth for
  // its own UI; this stored copy is a secondary correctness net.
  retiredRideIds: string[];
  notificationsEnabled: boolean;
  // YYYY-MM-DD in America/Los_Angeles. Scanner compares to today-PT and
  // skips devices whose armedDate doesn't match — that's the "auto-disarm
  // at park close" mechanism, no cron cleanup needed.
  armedDate: string | null;
  tripEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertFields {
  uid?: string | null;
  pushToken?: string | null;
  pushTokenType?: PushTokenType | null;
  mustDoRideIds?: string[];
  notificationsEnabled?: boolean;
  tripEnd?: string | null;
}

export async function upsertDevice(deviceId: string, fields: UpsertFields): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION).doc(deviceId);
  const now = new Date().toISOString();
  const existing = await docRef.get();
  if (!existing.exists) {
    await docRef.set({
      deviceId,
      uid: fields.uid ?? null,
      pushToken: fields.pushToken ?? null,
      pushTokenType: fields.pushTokenType ?? null,
      mustDoRideIds: fields.mustDoRideIds ?? [],
      retiredRideIds: [],
      notificationsEnabled: fields.notificationsEnabled ?? false,
      armedDate: null,
      tripEnd: fields.tripEnd ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    // Firestore rejects a document containing an explicit `undefined` value
    // anywhere in it — and a field a caller simply didn't pass through
    // (e.g. `uid` from a request body that omitted it) arrives here as
    // `undefined`, not absent, since UpsertFields spreads straight from the
    // handler. Drop those keys so an omitted field just leaves the stored
    // value untouched instead of failing the entire merge write.
    const updates: Record<string, unknown> = { ...fields, deviceId, updatedAt: now };
    for (const key of Object.keys(updates)) {
      if (updates[key] === undefined) delete updates[key];
    }
    await docRef.set(updates, { merge: true });
  }
}

// A device's identity (deviceId) lives in the app's AsyncStorage, but its push
// token is issued per install by the OS. Reinstalling the app wipes the former
// while typically preserving the latter, so the reinstalled app registers as a
// NEW doc while the OLD one keeps a live, still-deliverable token — and goes on
// pushing to the same handset regardless of what the user turns off in the new
// install (their toggle only ever writes their current doc). The scanner can't
// self-heal this either: its only token cleanup runs on a 404/410 from the push
// service, which a still-routable token never returns.
//
// So whenever a token is claimed, strip it from every other doc holding it and
// disable them — guaranteeing at most one record can deliver to one handset.
// Returns the ids that were reclaimed, for logging.
export async function reclaimPushToken(
  deviceId: string,
  pushToken: string
): Promise<string[]> {
  const db = getFirestore();
  const snap = await db.collection(COLLECTION).where('pushToken', '==', pushToken).get();
  const orphans = snap.docs.filter(doc => doc.id !== deviceId);
  if (orphans.length === 0) return [];
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const doc of orphans) {
    batch.set(
      doc.ref,
      { pushToken: null, pushTokenType: null, notificationsEnabled: false, updatedAt: now },
      { merge: true }
    );
  }
  await batch.commit();
  return orphans.map(doc => doc.id);
}

export async function setArmedDate(deviceId: string, date: string): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTION).doc(deviceId).set(
    { armedDate: date, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function setMustDoRideIds(deviceId: string, rideIds: string[]): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTION).doc(deviceId).set(
    { mustDoRideIds: rideIds, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function setRetiredRideIds(deviceId: string, rideIds: string[]): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTION).doc(deviceId).set(
    { retiredRideIds: rideIds, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

// Called right after a new trip is created (claim-free / promo / IAP) so a
// device's stored retiredRideIds don't survive into the new trip even if the
// client never runs again on this device (e.g. the trip was created from a
// different session). Devices that never sent a uid simply won't match —
// expected for anonymous/debug-only devices, which are out of scope for this
// reset per product decision.
export async function resetRetiredRideIdsForUid(uid: string): Promise<void> {
  const db = getFirestore();
  const snap = await db.collection(COLLECTION).where('uid', '==', uid).get();
  if (snap.empty) return;
  const now = new Date().toISOString();
  const batch = db.batch();
  snap.docs.forEach(doc => {
    batch.set(doc.ref, { retiredRideIds: [], updatedAt: now }, { merge: true });
  });
  await batch.commit();
}

export async function setDailyParks(deviceId: string, dailyParks: DailyParks): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTION).doc(deviceId).set(
    { dailyParks, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function setNotificationTypes(
  deviceId: string,
  types: NotificationTypes
): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTION).doc(deviceId).set(
    { notificationTypes: types, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | null> {
  const db = getFirestore();
  const doc = await db.collection(COLLECTION).doc(deviceId).get();
  if (!doc.exists) return null;
  return doc.data() as DeviceRecord;
}

// Returns today's date in America/Los_Angeles as YYYY-MM-DD. Used by /arm
// to stamp the device record at request time, and by the scanner to decide
// which devices are armed for the current operating day.
export function todayInPT(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

export const PUSH_TOKEN_TYPES: readonly PushTokenType[] = ['web', 'expo'];
