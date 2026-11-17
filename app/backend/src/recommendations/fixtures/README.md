# Recommendation scenario fixtures

One file per scenario from the spec (`~/.claude/specs/line-wait-ml/ai-recommendation-expectations.md`, section 11). Fourteen cases: S1, S1v, S2, S2a, S2b, S3, S4, S5, S5v, S6, S7, S7v, S8, S9.

These are the inputs the prompt builder consumes **after** the server has done its work (`promptInputs.ts` types), not raw `Ride` objects. That keeps them stable while the handler changes. The backend jest suite round-trips every fixture through `buildUserMessage`; the eval harness runs them against the live model and checks the `assert` block.

## Shape

```json
{
  "id": "S4",
  "title": "...",
  "tests": "what this case proves",
  "persona": "human-readable party description (the harness builds a Persona from it)",
  "context": { RequestContext },
  "rides": [ RideLine, ... ],      // already in code order (r1 = nearest)
  "assert": { ... }
}
```

`context.field` and ride `ofUsual` / `vsUsual` were computed with the cutoffs in `promptInputs.ts`. If the cutoffs change, regenerate rather than hand-edit.

Ride IDs are the real themeparks.wiki UUIDs from `ride_metadata.json`, so a harness that wants to run the full handler can map them back.

## `assert` keys

All keys optional. A case passes when every present key holds. The harness reports pass rate over runs (the model is not deterministic; the spec's bar is 4 of 5).

| Key | Meaning |
|---|---|
| `rank1` | array of rideIds; the rank-1 pick must be one of them |
| `notRank1` | array of rideIds that must not be rank 1 |
| `mustInclude` | rideIds that must appear somewhere in the list |
| `mayOmit` | rideIds whose absence is fine (documentation only) |
| `order` | array of `[a, b]`; when both are present, `a` ranks above `b` |
| `minRecs` | minimum number of recommendations returned |
| `skipPicksOpenWithBusyDay` | every pick whose ride has `verdict: "skip"` has a first clause (text before the first comma, period, or semicolon) matching `/busy|long|slammed|least bad|closest to normal|packed|crowded/i` |
| `noForeignNumbers` | any integer in a pick's caption must appear in that ride's line (`wait`, `arrive`, `usual`, `vsUsual` absolute, `walk`, a bucket value, or `window.wait`) |
| `forbiddenWordsAll` | case-insensitive substrings no caption in the response may contain |
| `rank1MayName` | rideIds the rank-1 caption is allowed to name (documentation; the global no-other-names rule still applies to rank 3 and below) |
| `perRide` | map of rideId to per-pick checks, applied only if that ride is in the response |

Per-ride checks:

| Key | Meaning |
|---|---|
| `restrictionNote` | `true` means `restrictionNote` must be a non-empty string |
| `forbiddenWords` | case-insensitive substrings the caption must not contain |
| `requiredAnyPhrase` | at least one of these case-insensitive substrings must appear in the caption |

## Global checks (apply to every case, not listed per file)

- No caption contains its own ride's name.
- No caption contains `%`, an em dash, or `!`.
- No caption contains: `verdict`, `badge`, `score`, `star-rated`, `must-do`, `your list`.
- Rank 3 and below name no other ride.
- Output parsed as valid JSON in the documented shape, ride IDs resolved to the pool.
