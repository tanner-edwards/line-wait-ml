// Sign in with Apple token revocation.
//
// Apple has required since June 2022 that an app offering Sign in with Apple
// revoke the user's tokens when they delete their account — deleting your own
// records is not enough. Sign in with Apple is Club 32's only iOS login, so
// this is squarely in scope for guideline 5.1.1(v).
//
// Flow:
//   1. At sign-in the app hands us Apple's one-time authorization code.
//   2. We exchange it for a long-lived refresh token (needs a client secret,
//      which is an ES256 JWT signed with the team's .p8 key).
//   3. We store that refresh token on the user record.
//   4. On account deletion we POST it to Apple's revoke endpoint.
//
// Everything here no-ops with a warning when the Apple credentials aren't
// configured. Account deletion must never be blocked by this — a user who
// cannot delete their account is a worse violation than a stale token.

import * as crypto from 'crypto';

const APPLE_AUTH_BASE = 'https://appleid.apple.com/auth';
const CLIENT_SECRET_TTL_SECONDS = 15 * 60;

function readPrivateKey(): string | undefined {
  const raw = process.env.APPLE_PRIVATE_KEY;
  if (!raw) return undefined;

  // deploy.sh base64-encodes the .p8 so SAM's shorthand Key=Value parser
  // doesn't choke on the PEM's newlines and '=' padding — same trick the
  // Firebase service-account JSON uses. A raw PEM is accepted too, for local
  // runs. Either way, collapse literal \n sequences into real newlines.
  const pem = raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return pem.replace(/\\n/g, '\n');
}

function config() {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.APPLE_CLIENT_ID;
  const privateKey = readPrivateKey();

  if (!teamId || !keyId || !clientId || !privateKey) return null;
  return { teamId, keyId, clientId, privateKey };
}

export function isAppleRevocationConfigured(): boolean {
  return config() !== null;
}

function buildClientSecret(cfg: NonNullable<ReturnType<typeof config>>): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' };
  const claims = {
    iss: cfg.teamId,
    iat: now,
    exp: now + CLIENT_SECRET_TTL_SECONDS,
    aud: 'https://appleid.apple.com',
    sub: cfg.clientId,
  };

  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(claims)}`;

  // JWS wants the raw R||S pair, not the DER encoding Node emits by default.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: crypto.createPrivateKey(cfg.privateKey),
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${signature.toString('base64url')}`;
}

async function postForm(path: string, params: Record<string, string>): Promise<Response> {
  return fetch(`${APPLE_AUTH_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

/**
 * Trades Apple's one-time authorization code for a refresh token.
 * Returns null when unconfigured or when Apple rejects the exchange — the
 * caller treats that as "no token to store" rather than a sign-in failure.
 */
export async function exchangeAuthorizationCode(code: string): Promise<string | null> {
  const cfg = config();
  if (!cfg) {
    console.warn('[appleAuth] Apple credentials not configured; skipping code exchange');
    return null;
  }

  try {
    const res = await postForm('token', {
      client_id: cfg.clientId,
      client_secret: buildClientSecret(cfg),
      code,
      grant_type: 'authorization_code',
    });

    if (!res.ok) {
      console.warn('[appleAuth] code exchange failed', res.status, await res.text());
      return null;
    }

    const body = (await res.json()) as { refresh_token?: string };
    return body.refresh_token ?? null;
  } catch (err) {
    console.warn('[appleAuth] code exchange threw', err);
    return null;
  }
}

/**
 * Revokes a refresh token. Returns whether Apple accepted it; callers log the
 * result but must continue deleting the account either way.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<boolean> {
  const cfg = config();
  if (!cfg) {
    console.warn('[appleAuth] Apple credentials not configured; skipping revocation');
    return false;
  }

  try {
    const res = await postForm('revoke', {
      client_id: cfg.clientId,
      client_secret: buildClientSecret(cfg),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });

    if (!res.ok) {
      console.warn('[appleAuth] revoke failed', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[appleAuth] revoke threw', err);
    return false;
  }
}
