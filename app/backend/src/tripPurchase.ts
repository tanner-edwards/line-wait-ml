// StoreKit 2 JWS transaction verification + IAP trip write.
//
// Flow:
//   1. App completes StoreKit purchase, gets a signed JWS transaction.
//   2. App POSTs JWS + trip dates to POST /v1/users/trip/purchase.
//   3. This module verifies the JWS:
//      - Xcode environment: skip signature check (local StoreKit config).
//      - Sandbox / Production: verify certificate chain + ES256 signature.
//   4. On success, writes trips/{uid}, marks freeTripClaimed, returns trip.

import * as crypto from 'crypto';
import { getFirestore } from './firestoreClient';
import { TripRecord } from './types';

const EXPECTED_PRODUCT_ID = 'com.tannere.club32.trip';

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

  // Root cert must originate from Apple.
  const root = certs[certs.length - 1];
  if (!root.issuer.includes('Apple')) {
    throw new Error('Certificate chain does not originate from Apple');
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
  // Decode the payload first (without verification) to check the environment.
  const unverified = decodePayload(transactionJws);

  // Xcode local StoreKit config is signed with a dev key — skip chain verification.
  // All other environments go through full verification.
  const payload =
    unverified.environment === 'Xcode'
      ? unverified
      : await verifyAndDecodeJws(transactionJws);

  if (payload.productId !== EXPECTED_PRODUCT_ID) {
    throw new Error(`Unexpected product: ${payload.productId}`);
  }

  if (!payload.transactionId) {
    throw new Error('Transaction ID missing from JWS payload');
  }

  const db = getFirestore();
  const trip: TripRecord = {
    uid,
    tripStart,
    tripEnd,
    purchasedAt: new Date().toISOString(),
    source: 'iap',
    transactionId: payload.transactionId,
  };

  await Promise.all([
    db.collection('trips').add(trip),
    db.collection('users').doc(uid).update({ freeTripClaimed: true }),
  ]);

  return trip;
}
