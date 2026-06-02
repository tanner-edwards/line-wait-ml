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

export type NotificationKind = 'trough' | 'closure' | 'reopen';
export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['trough', 'closure', 'reopen'];

export type NotificationTypes = Record<NotificationKind, boolean>;

export interface DeviceRecord {
  deviceId: string;
  pushToken: string | null;
  pushTokenType: PushTokenType | null;
  mustDoRideIds: string[];
  notificationsEnabled: boolean;
  // YYYY-MM-DD in America/Los_Angeles. Scanner compares to today-PT and
  // skips devices whose armedDate doesn't match — that's the "auto-disarm
  // at park close" mechanism, no cron cleanup needed.
  armedDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertFields {
  pushToken?: string | null;
  pushTokenType?: PushTokenType | null;
  mustDoRideIds?: string[];
  notificationsEnabled?: boolean;
}

export async function upsertDevice(deviceId: string, fields: UpsertFields): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection(COLLECTION).doc(deviceId);
  const now = new Date().toISOString();
  const existing = await docRef.get();
  if (!existing.exists) {
    await docRef.set({
      deviceId,
      pushToken: fields.pushToken ?? null,
      pushTokenType: fields.pushTokenType ?? null,
      mustDoRideIds: fields.mustDoRideIds ?? [],
      notificationsEnabled: fields.notificationsEnabled ?? false,
      armedDate: null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await docRef.set({ ...fields, updatedAt: now }, { merge: true });
  }
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
