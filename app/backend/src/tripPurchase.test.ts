// Pins two bugs that handed out free paid trips.
//
//   1. The JWS payload was decoded without verification, and signature
//      checking was skipped entirely when that unverified payload said
//      `environment: 'Xcode'` — trivially forgeable.
//   2. A valid receipt could be replayed to mint unlimited trips.

jest.mock('./firestoreClient', () => ({ getFirestore: jest.fn() }));

import { getFirestore } from './firestoreClient';

const PRODUCT_ID = 'com.tannere.club32.trip';
const TRIP_START = '2026-11-01';
const TRIP_END = '2026-11-03';

function b64url(value: object | string): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(raw).toString('base64url');
}

/** A structurally valid JWS whose signature is garbage. */
function forgedJws(payload: object, header: object = { alg: 'ES256', x5c: [] }): string {
  return `${b64url(header)}.${b64url(payload)}.${b64url('not-a-real-signature')}`;
}

function mockBatch(commitImpl: () => Promise<unknown>) {
  const batch = {
    create: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    commit: jest.fn(commitImpl),
  };
  (getFirestore as jest.Mock).mockReturnValue({
    batch: () => batch,
    collection: () => ({ doc: () => ({ id: 'generated-trip-id' }) }),
  });
  return batch;
}

/** Re-imports the module so the ALLOW_XCODE_RECEIPTS constant picks up env. */
function loadModule(): typeof import('./tripPurchase') {
  let mod!: typeof import('./tripPurchase');
  jest.isolateModules(() => {
    mod = require('./tripPurchase') as typeof import('./tripPurchase');
  });
  return mod;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ALLOW_XCODE_RECEIPTS;
});

describe('without ALLOW_XCODE_RECEIPTS (deployed config)', () => {
  it('rejects a forged receipt claiming the Xcode environment', async () => {
    const { purchaseTrip } = loadModule();
    const jws = forgedJws({
      environment: 'Xcode',
      productId: PRODUCT_ID,
      transactionId: '999',
    });

    await expect(purchaseTrip('uid-1', jws, TRIP_START, TRIP_END)).rejects.toThrow();
    expect(getFirestore).not.toHaveBeenCalled();
  });

  it('rejects a chain that does not terminate at the real Apple root', async () => {
    const { purchaseTrip } = loadModule();
    // Self-signed cert whose issuer string merely contains "Apple" — this used
    // to satisfy the root check.
    const jws = forgedJws(
      { environment: 'Production', productId: PRODUCT_ID, transactionId: '1000' },
      { alg: 'ES256', x5c: ['ZmFrZS1sZWFm', 'ZmFrZS1BcHBsZS1yb290'] }
    );

    await expect(purchaseTrip('uid-1', jws, TRIP_START, TRIP_END)).rejects.toThrow();
    expect(getFirestore).not.toHaveBeenCalled();
  });
});

describe('with ALLOW_XCODE_RECEIPTS (local StoreKit testing)', () => {
  beforeEach(() => {
    process.env.ALLOW_XCODE_RECEIPTS = 'true';
  });

  it('rejects a replayed transaction', async () => {
    mockBatch(() => Promise.reject(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })));
    const { purchaseTrip } = loadModule();
    const jws = forgedJws({
      environment: 'Xcode',
      productId: PRODUCT_ID,
      transactionId: 'already-used',
    });

    await expect(purchaseTrip('uid-1', jws, TRIP_START, TRIP_END)).rejects.toThrow(
      /already redeemed/i
    );
  });

  it('reserves the transaction id in the same batch as the trip write', async () => {
    const batch = mockBatch(() => Promise.resolve([]));
    const { purchaseTrip } = loadModule();
    const jws = forgedJws({
      environment: 'Xcode',
      productId: PRODUCT_ID,
      transactionId: 'txn-123',
    });

    const trip = await purchaseTrip('uid-1', jws, TRIP_START, TRIP_END);

    expect(trip.transactionId).toBe('txn-123');
    expect(batch.create).toHaveBeenCalledTimes(1);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('rejects an unexpected product id', async () => {
    mockBatch(() => Promise.resolve([]));
    const { purchaseTrip } = loadModule();
    const jws = forgedJws({
      environment: 'Xcode',
      productId: 'com.tannere.club32.something-else',
      transactionId: 'txn-456',
    });

    await expect(purchaseTrip('uid-1', jws, TRIP_START, TRIP_END)).rejects.toThrow(
      /unexpected product/i
    );
  });
});
