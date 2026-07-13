// StoreKit 2 JWS transaction verification + IAP trip write.
//
// Flow:
//   1. App completes StoreKit purchase, gets a signed JWS transaction.
//   2. App POSTs JWS + trip dates to POST /v1/users/trip/purchase.
//   3. This module decodes the JWS payload and checks the product ID.
//      - environment "Xcode": local StoreKit config — skip signature check.
//      - environment "Sandbox" / "Production": TODO full signature verification
//        via Apple JWKS before App Store launch.
//   4. On success, writes trips/{uid} and returns the trip record.

import { getFirestore } from './firestoreClient';
import { TripRecord } from './types';

const EXPECTED_PRODUCT_ID = 'com.tannere.club32.trip';

interface JWSTransactionPayload {
  productId?: string;
  transactionId?: string;
  environment?: 'Xcode' | 'Sandbox' | 'Production';
  type?: string;
}

function decodeJwsPayload(jws: string): JWSTransactionPayload {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWS format');
  // base64url → base64 → Buffer → JSON
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(base64, 'base64').toString('utf8');
  return JSON.parse(json) as JWSTransactionPayload;
}

export async function purchaseTrip(
  uid: string,
  transactionJws: string,
  tripStart: string,
  tripEnd: string
): Promise<TripRecord> {
  const payload = decodeJwsPayload(transactionJws);

  if (payload.productId !== EXPECTED_PRODUCT_ID) {
    throw new Error(`Unexpected product: ${payload.productId}`);
  }

  if (!payload.transactionId) {
    throw new Error('Transaction ID missing from JWS payload');
  }

  // Sandbox and Production builds should have JWS signature verified against
  // Apple's JWKS (https://appleid.apple.com/auth/keys) before App Store launch.
  // Xcode local StoreKit config is trusted without verification.
  if (payload.environment !== 'Xcode' && payload.environment !== 'Sandbox') {
    // Production — add JWKS signature verification here before going live.
    // For now, allow through so TestFlight sandbox testing works end-to-end.
  }

  const db = getFirestore();
  const trip: TripRecord = {
    tripStart,
    tripEnd,
    purchasedAt: new Date().toISOString(),
    source: 'iap',
    transactionId: payload.transactionId,
  };

  await Promise.all([
    db.collection('trips').doc(uid).set(trip),
    db.collection('users').doc(uid).update({ freeTripClaimed: true }),
  ]);

  return trip;
}
