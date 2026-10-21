// Feature flags — Firestore-backed switches for features we want to turn on
// or off without a deploy or an App Store review.
//
// All flags live in one doc, config/featureFlags:
//   { freeTrip: { enabled: true, minAppVersion: "1.1.0" } }   // min optional
//
// The backend is the single decider. The app sends its version in the
// x-app-version header; GET /v1/flags returns already-evaluated booleans, and
// value-granting routes (claim-free) check the same rule server-side.
//
// Rule:
//   - doc missing / unreadable / flag absent  → off (fail closed)
//   - x-app-version present                   → enabled AND version >= min
//                                               (malformed version → off)
//   - x-app-version missing                   → enabled only. Builds shipped
//                                               before flags existed send no
//                                               header and must keep working.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { TTLCache } from './cache';
import { getFirestore } from './firestoreClient';

export const FLAG_NAMES = ['freeTrip'] as const;
export type FeatureFlagName = (typeof FLAG_NAMES)[number];
export type FeatureFlags = Record<FeatureFlagName, boolean>;

interface FlagConfig {
  enabled?: unknown;
  minAppVersion?: unknown;
}
type FlagsDoc = Partial<Record<string, FlagConfig>>;

// Same staleness bound as the entitlement cache — a console edit is live
// within a minute.
const CACHE_TTL_MS = 60_000;
const docCache = new TTLCache<'doc', FlagsDoc>(CACHE_TTL_MS);

async function loadFlagsDoc(): Promise<FlagsDoc> {
  const cached = docCache.get('doc');
  if (cached) return cached;
  let doc: FlagsDoc;
  try {
    const snap = await getFirestore().collection('config').doc('featureFlags').get();
    doc = snap.exists ? ((snap.data() as FlagsDoc) ?? {}) : {};
  } catch (err) {
    console.warn('[featureFlags] Could not read config/featureFlags; all flags off', err);
    doc = {};
  }
  // Cache failures too, so a Firestore outage doesn't turn into a read per request.
  docCache.set('doc', doc);
  return doc;
}

export function getAppVersion(event: APIGatewayProxyEvent): string | null {
  const headers = event.headers ?? {};
  const value = headers['x-app-version'] ?? headers['X-App-Version'] ?? '';
  return value.trim() || null;
}

/** Parses "1.2.3" → [1, 2, 3]. Returns null for anything that isn't dotted digits. */
function parseVersion(version: string): number[] | null {
  if (!/^\d+(\.\d+)*$/.test(version)) return null;
  return version.split('.').map(Number);
}

/** Negative if a < b, 0 if equal, positive if a > b. Missing parts count as 0. */
export function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function evaluate(config: FlagConfig | undefined, appVersion: string | null): boolean {
  if (!config || config.enabled !== true) return false;
  if (appVersion === null) return true;
  const app = parseVersion(appVersion);
  if (!app) return false;
  if (typeof config.minAppVersion !== 'string' || config.minAppVersion === '') return true;
  const min = parseVersion(config.minAppVersion);
  if (!min) return false; // a typo in the doc shouldn't silently turn a flag on
  return compareVersions(app, min) >= 0;
}

export async function isFlagEnabled(
  name: FeatureFlagName,
  appVersion: string | null
): Promise<boolean> {
  const doc = await loadFlagsDoc();
  return evaluate(doc[name], appVersion);
}

export async function evaluateFlags(appVersion: string | null): Promise<FeatureFlags> {
  const doc = await loadFlagsDoc();
  const flags = {} as FeatureFlags;
  for (const name of FLAG_NAMES) flags[name] = evaluate(doc[name], appVersion);
  return flags;
}

// Test helper
export function _resetForTests(): void {
  docCache.clear();
}
