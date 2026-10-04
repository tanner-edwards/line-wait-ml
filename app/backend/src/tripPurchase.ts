// StoreKit 2 JWS transaction verification + IAP trip write.
//
// Flow:
//   1. App completes StoreKit purchase, gets a signed JWS transaction.
//   2. App POSTs JWS + trip dates to POST /v1/users/trip/purchase.
//   3. This module verifies the certificate chain terminates at Apple's real
//      root, that every cert is in date, and that the ES256 signature is valid.
//   4. On success, writes trips/{uid}, marks freeTripClaimed, returns trip.
//
// Two holes used to live here, both of which handed out free paid trips:
//   - The payload was decoded WITHOUT verification and, if that unverified
//     payload claimed `environment: 'Xcode'`, signature checking was skipped
//     entirely. Anyone could forge one. Local StoreKit testing now requires
//     ALLOW_XCODE_RECEIPTS, which is never set in production.
//   - The root was accepted on `issuer.includes('Apple')`, a string an
//     attacker sets on their own self-signed chain. The root is now pinned to
//     the real certificate by fingerprint.

import * as crypto from 'crypto';
import { getFirestore } from './firestoreClient';
import { TripRecord } from './types';

const EXPECTED_PRODUCT_ID = 'com.tannere.club32.trip';

// SHA-256 of the DER encoding of "Apple Root CA - G3", which every StoreKit 2
// JWS chain terminates at. Verified against
// https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
const APPLE_ROOT_CA_G3_SHA256 =
  '63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179';

// Escape hatch for the local Xcode StoreKit config, whose receipts are signed
// with a dev key that chains to no real root. Absent in deployed stacks, so
// production has no code path that reaches an unverified payload.
const ALLOW_XCODE_RECEIPTS = process.env.ALLOW_XCODE_RECEIPTS === 'true';

interface JWSTransactionPayload {
  productId?: string;
  transactionId?: string;
  environment?: 'Xcode' | 'Sandbox' | 'Production';
}

// --- JWS helpers ---

function fromBase64url(b64url: string): Buffer {
  return Buffer.from(b64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodePayload(jws: string): JWSTransactionPayload {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWS format');
  return JSON.parse(fromBase64url(parts[1]).toString('utf8')) as JWSTransactionPayload;
}

// Verify the certificate chain and ES256 signature, then return the decoded payload.
// Throws if any check fails.
async function verifyAndDecodeJws(jws: string): Promise<JWSTransactionPayload> {
  const parts = jws.split('.');
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(fromBase64url(headerB64).toString('utf8')) as {
    alg?: string;
    x5c?: string[];
  };

  if (header.alg !== 'ES256') {
    throw new Error(`Unexpected JWS algorithm: ${header.alg}`);
  }

  const x5c = header.x5c;
  if (!x5c || x5c.length < 2) {
    throw new Error('Missing or incomplete certificate chain in JWS header');
  }

  // Build X.509 objects from DER-encoded x5c entries (standard base64, not base64url).
  const certs = x5c.map(c => new crypto.X509Certificate(Buffer.from(c, 'base64')));

  // Verify each cert is signed by the next in the chain.
  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i].verify(certs[i + 1].publicKey)) {
      throw new Error(`Certificate chain broken at index ${i}`);
    }
  }

  // Pin the root. An issuer-string check is worthless here: the chain above
  // only proves the certs sign each other, which an attacker's own chain does
  // too, and `issuer` is a field they fill in.
  const root = certs[certs.length - 1];
  const rootFingerprint = root.fingerprint256.replace(/:/g, '').toUpperCase();
  if (rootFingerprint !== APPLE_ROOT_CA_G3_SHA256) {
    throw new Error('Apple receipt verification failed: chain does not terminate at Apple Root CA - G3');
  }

  // An expired or not-yet-valid cert anywhere in the chain invalidates it.
  const now = Date.now();
  for (const cert of certs) {
    if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) {
      throw new Error('Apple receipt verification failed: certificate outside its validity period');
    }
  }

  // Verify the JWS signature using the leaf certificate's public key.
  // Web Crypto ECDSA accepts IEEE P1363 (R || S) format, which is exactly
  // what JWS produces — no DER conversion needed.
  const { subtle } = crypto;
  const leafSpki = certs[0].publicKey.export({ type: 'spki', format: 'der' }) as Buffer;

  const cryptoKey = await subtle.importKey(
    'spki',
    new Uint8Array(leafSpki),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  const valid = await subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new Uint8Array(fromBase64url(signatureB64)),
    new Uint8Array(Buffer.from(`${headerB64}.${payloadB64}`)),
  );

  if (!valid) throw new Error('JWS signature verification failed');

  return JSON.parse(fromBase64url(payloadB64).toString('utf8')) as JWSTransactionPayload;
}

// --- Public entry point ---

export async function purchaseTrip(
  uid: string,
  transactionJws: string,
  tripStart: string,
  tripEnd: string,
): Promise<TripRecord> {
  // Never let unverified payload data decide whether to verify. Outside local
  // Xcode testing there is exactly one path, and it checks the signature.
  let payload: JWSTransactionPayload;
  if (ALLOW_XCODE_RECEIPTS) {
    const unverified = decodePayload(transactionJws);
    payload =
      unverified.environment === 'Xcode'
        ? unverified
        : await verifyAndDecodeJws(transactionJws);
  } else {
    payload = await verifyAndDecodeJws(transactionJws);
  }

  if (payload.productId !== EXPECTED_PRODUCT_ID) {
    throw new Error(`Apple receipt verification failed: unexpected product ${payload.productId}`);
  }

  if (!payload.transactionId) {
    throw new Error('Apple receipt verification failed: transaction ID missing from JWS payload');
  }

  const db = getFirestore();
  const tripRef = db.collection('trips').doc();
  const trip: TripRecord = {
    id: tripRef.id,
    uid,
    tripStart,
    tripEnd,
    purchasedAt: new Date().toISOString(),
    source: 'iap',
    transactionId: payload.transactionId,
  };

  // create() fails the whole batch if this transaction was already redeemed,
  // which makes redemption idempotent without a read-then-write race. A valid
  // receipt previously minted unlimited trips if replayed.
  const batch = db.batch();
  batch.create(db.collection('redeemedTransactions').doc(payload.transactionId), {
    uid,
    tripId: tripRef.id,
    productId: payload.productId,
    redeemedAt: trip.purchasedAt,
  });
  batch.set(tripRef, trip);
  batch.update(db.collection('users').doc(uid), { freeTripClaimed: true });

  try {
    await batch.commit();
  } catch (err) {
    // Firestore ALREADY_EXISTS — the transaction has been redeemed before.
    if (err && typeof err === 'object' && (err as { code?: number }).code === 6) {
      throw new Error('Apple receipt verification failed: transaction already redeemed');
    }
    throw err;
  }

  return trip;
}
