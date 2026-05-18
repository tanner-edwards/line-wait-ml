// Singleton Firestore client. Reads the service-account JSON from the
// FIREBASE_SERVICE_ACCOUNT_JSON env var (supplied by SAM as a NoEcho parameter).
// Throws loudly on first call if the env var is missing or malformed — better
// to fail at cold start than silently degrade.
//
// Used by both the waits handler (read historical_averages) and the averages
// cron (read wait_times, write historical_averages).

import * as admin from 'firebase-admin';

let app: admin.app.App | null = null;

export function initFirebase(): admin.app.App {
  if (app) return app;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON env var is not set. Deploy via deploy.sh.'
    );
  }

  // deploy.sh base64-encodes the JSON to sidestep SAM CLI's
  // --parameter-overrides quirk that mangles inner-quoted strings. Accept
  // either form: try raw JSON first, fall back to base64-decode.
  const parsed = tryParseJson(raw) ?? tryParseBase64(raw);
  if (!parsed) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is neither valid JSON nor valid base64-encoded JSON.'
    );
  }

  app = admin.initializeApp({
    credential: admin.credential.cert(parsed),
  });
  return app;
}

function tryParseJson(s: string): admin.ServiceAccount | null {
  // A raw JSON value will start with '{' as its first non-whitespace char.
  // Skip the parse attempt otherwise — saves a try/catch on the b64 path.
  if (s.trimStart().charAt(0) !== '{') return null;
  try {
    return JSON.parse(s) as admin.ServiceAccount;
  } catch {
    return null;
  }
}

function tryParseBase64(s: string): admin.ServiceAccount | null {
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf-8');
    return JSON.parse(decoded) as admin.ServiceAccount;
  } catch {
    return null;
  }
}

export function getFirestore(): admin.firestore.Firestore {
  return initFirebase().firestore();
}

// Test helper — resets the singleton between tests.
export function _resetForTests(): void {
  if (app) {
    void app.delete().catch(() => undefined);
  }
  app = null;
}
