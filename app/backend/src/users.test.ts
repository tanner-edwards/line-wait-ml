// The free-trip ledger is the last thing standing between "delete your account"
// and unlimited free premium. Two ways through it used to exist:
//
//   1. The key came from a client-supplied `appleId` in the request body, so a
//      fresh value bought a fresh free trip.
//   2. It keyed on something tied to the Firebase uid, which rotates when the
//      Auth user is deleted and the same person signs up again.
//
// These tests pin the key to a hash of Apple's stable identifier instead.

jest.mock('./firestoreClient', () => ({ getFirestore: jest.fn() }));
jest.mock('./appleAuth', () => ({ revokeRefreshToken: jest.fn() }));

import * as crypto from 'crypto';
import { getFirestore } from './firestoreClient';
import { claimFreeTrip, freeTripLedgerKey } from './users';

const APPLE_SUB = '001234.abcdef0123456789.1234';
const TRIP_START = '2026-11-01';
const TRIP_END = '2026-11-03';

interface Fixture {
  claimedDocIds: string[];
  batch: { set: jest.Mock; update: jest.Mock; commit: jest.Mock };
}

/** Firestore stub that records which doc id the ledger lookup used. */
function setupFirestore(opts: { userExists?: boolean; alreadyClaimed?: boolean } = {}): Fixture {
  const { userExists = true, alreadyClaimed = false } = opts;
  const claimedDocIds: string[] = [];
  const batch = { set: jest.fn(), update: jest.fn(), commit: jest.fn().mockResolvedValue([]) };

  (getFirestore as jest.Mock).mockReturnValue({
    batch: () => batch,
    collection: (name: string) => ({
      doc: (id?: string) => {
        if (name === 'claimedFreeTrips') {
          claimedDocIds.push(id as string);
          return { id, get: async () => ({ exists: alreadyClaimed }) };
        }
        if (name === 'users') {
          return {
            id,
            get: async () => ({
              exists: userExists,
              data: () => ({ userId: id, freeTripClaimed: false }),
            }),
          };
        }
        return { id: id ?? 'generated-trip-id' };
      },
    }),
  });

  return { claimedDocIds, batch };
}

beforeEach(() => jest.clearAllMocks());

describe('freeTripLedgerKey', () => {
  it('hashes the Apple identifier rather than storing it', () => {
    const key = freeTripLedgerKey(APPLE_SUB);
    expect(key).not.toContain(APPLE_SUB);
    expect(key).toBe(crypto.createHash('sha256').update(APPLE_SUB).digest('hex'));
  });

  it('is stable for the same identifier and distinct across identifiers', () => {
    expect(freeTripLedgerKey(APPLE_SUB)).toBe(freeTripLedgerKey(APPLE_SUB));
    expect(freeTripLedgerKey(APPLE_SUB)).not.toBe(freeTripLedgerKey('001999.different.5678'));
  });
});

describe('claimFreeTrip', () => {
  it('keys the ledger on the Apple identifier, not the uid', async () => {
    const { claimedDocIds } = setupFirestore();

    await claimFreeTrip('firebase-uid-1', APPLE_SUB, TRIP_START, TRIP_END);

    expect(claimedDocIds).toEqual([freeTripLedgerKey(APPLE_SUB)]);
    expect(claimedDocIds[0]).not.toContain('firebase-uid-1');
  });

  it('still matches after a delete and re-signup rotates the uid', async () => {
    const first = setupFirestore();
    await claimFreeTrip('uid-before-deletion', APPLE_SUB, TRIP_START, TRIP_END);

    // Same person, brand new Firebase uid — the ledger must still find them.
    const second = setupFirestore({ alreadyClaimed: true });
    await expect(
      claimFreeTrip('uid-after-resignup', APPLE_SUB, TRIP_START, TRIP_END)
    ).rejects.toThrow(/already claimed/i);

    expect(second.claimedDocIds[0]).toBe(first.claimedDocIds[0]);
  });

  it('refuses a second claim once the ledger entry exists', async () => {
    const { batch } = setupFirestore({ alreadyClaimed: true });

    await expect(claimFreeTrip('uid-1', APPLE_SUB, TRIP_START, TRIP_END)).rejects.toThrow(
      /already claimed/i
    );
    expect(batch.commit).not.toHaveBeenCalled();
  });

  it('writes the ledger entry in the same batch as the trip', async () => {
    const { batch } = setupFirestore();

    await claimFreeTrip('uid-1', APPLE_SUB, TRIP_START, TRIP_END);

    expect(batch.commit).toHaveBeenCalledTimes(1);
    // trip doc + ledger entry
    expect(batch.set).toHaveBeenCalledTimes(2);
  });
});
