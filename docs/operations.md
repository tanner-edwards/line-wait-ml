# Club 32 — Operations Runbook

Operational tasks that aren't obvious from the code.

---

## Adding a promo code

Promo codes are stored in the `promoCodes` Firestore collection. Each document ID is the code itself (uppercase).

1. Open the [Firebase Console](https://console.firebase.google.com) → **llm-wait-times** → Firestore → `promoCodes` collection.
2. Click **Add document**.
3. Set the **Document ID** to the code you want (e.g. `SUMMER25`). Use uppercase — the app normalizes input before validating.
4. Add these fields:

| Field | Type | Value |
|---|---|---|
| `type` | string | `free_trip` |
| `maxUses` | number | How many times the code can be used (e.g. `50`) |
| `timesUsed` | number | `0` |
| `expiresAt` | string | ISO expiry date — e.g. `2026-12-31T23:59:59Z` |
| `active` | boolean | `true` |

5. Click **Save**.

The code is live immediately — no deploy needed.

**To disable a code:** set `active` to `false`.  
**To extend expiry:** update `expiresAt`.  
**To check usage:** read the `timesUsed` field.

---

## Granting developer / beta access (bypass flag)

To give a user full paid access without a trip or payment:

1. Firestore → `users` collection → find the user's document (doc ID = Firebase UID).
2. Set the `bypass` field to `true`.

Revoke by setting it back to `false`. Takes effect on the user's next app launch.

---

## Adding a new Disney ride

When a new ride opens, it won't appear in the app until it's in the metadata allowlist:

1. Add an entry to `ride_metadata.json` at the repo root with `themeparks_id`, `lat`, `lng`, `name`, and `tracks_wait_time: true`.
2. Re-run the seeder:
   ```
   cd cron && GOOGLE_APPLICATION_CREDENTIALS=../firebase-key.json python populate_ride_metadata.py
   ```

See `CLAUDE.md` for the full field list.
