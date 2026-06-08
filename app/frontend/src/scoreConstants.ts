// Minimum bucket0 sampleCount before scoring signals are considered trustworthy.
//
// History: collection started 2026-05-02. Set to 10 on 2026-06-07 when we had
// ~36 days of data (weekday ~78 samples/bucket, weekend ~30, holiday ~3).
// Holiday buckets are intentionally suppressed at this threshold — 3 samples
// is too thin to trust. Raise toward 20 around 2026-07-07 (≈60 days), when
// weekend counts will be ~60 and we'll have a broader holiday sample too.
//
// scanner.js and app/backend/src/scoring/score.ts each have their own copy of
// this constant — keep all three in sync when you change the value.
export const MIN_BUCKET_SAMPLE_COUNT = 10;
