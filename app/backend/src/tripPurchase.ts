// Apple receipt verification + IAP trip write.
//
// Flow:
//   1. App completes StoreKit purchase, gets a base64 receipt.
//   2. App POSTs receipt + trip dates to POST /v1/users/trip/purchase.
//   3. This module verifies the receipt with Apple (prod first, sandbox fallback).
//   4. On success, writes trips/{uid} and returns the trip record.

import { getFirestore } from './firestoreClient';
import { TripRecord } from './types';

const APPLE_VERIFY_PROD    = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_VERIFY_SANDBOX = 'https://sandbox.itunes.apple.com/verifyReceipt';
const EXPECTED_PRODUCT_ID  = 'com.tannere.club32.trip';

interface AppleVerifyResponse {
  status: number;
  receipt?: {
    in_app?: { product_id: string; transaction_id: string; purchase_date_ms: string }[];
  };
}

async function verifyWithApple(
  receiptData: string,
  sharedSecret: string,
  url: string
): Promise<AppleVerifyResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'receipt-data': receiptData, password: sharedSecret }),
  });
  return res.json() as Promise<AppleVerifyResponse>;
}

export async function purchaseTrip(
  uid: string,
  receiptData: string,
  tripStart: string,
  tripEnd: string
): Promise<TripRecord> {
  const sharedSecret = process.env.APPLE_SHARED_SECRET ?? '';
  if (!sharedSecret) throw new Error('APPLE_SHARED_SECRET not configured');

  // Try production endpoint first; Apple returns 21007 if a sandbox receipt
  // is sent to production — retry against sandbox in that case.
  let result = await verifyWithApple(receiptData, sharedSecret, APPLE_VERIFY_PROD);
  if (result.status === 21007) {
    result = await verifyWithApple(receiptData, sharedSecret, APPLE_VERIFY_SANDBOX);
  }

  if (result.status !== 0) {
    throw new Error(`Apple receipt verification failed: status ${result.status}`);
  }

  const inApp = result.receipt?.in_app ?? [];
  const match = inApp.find(p => p.product_id === EXPECTED_PRODUCT_ID);
  if (!match) {
    throw new Error('Receipt does not contain expected product');
  }

  const db = getFirestore();
  const trip: TripRecord = {
    tripStart,
    tripEnd,
    purchasedAt: new Date().toISOString(),
    source: 'iap',
    transactionId: match.transaction_id,
  };

  await db.collection('trips').doc(uid).set(trip);
  return trip;
}
