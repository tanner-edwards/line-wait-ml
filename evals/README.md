# evals: the recommendation prompt, measured against the spec

Scores the `/v2/recommendations` Bedrock call against **"Club 32: AI Recommendation Expectations"**
(2026-11-16). Separate from the app; it imports the backend's code but changes nothing there.

## Quick start

```bash
cd evals && npm install          # once
npm run dry-run                  # free, no AWS: proves fixtures, checks and reference answers are sound
npm run eval -- --mock           # free: the whole pipeline with fake answers
npm run judge-check              # validate the AI judges on known good/bad answers (do this once first)
npm run eval                     # real run: v1 prompt, 14 scenarios x 5 runs, AI judges, HTML report
```

`eval` prints one line (how many scenarios pass at least 4 of 5 runs, the spec's bar) and opens the
report. History of every run: `site/index.html`. Re-grade and re-judge a saved run without model
calls: `npm run eval -- --from v1`.

## What it checks

**Scenarios** (`src/fixtures/scenarios.ts`): the spec's section 11, S1 to S9 with variants, 14 in all.
Values the spec does not state are listed per scenario (`filled`) and shown in the report under
"Values the spec did not state". Please confirm them. Static ride facts (height, thrill level,
pregnancy advisory) come from `ride_metadata.json`.

**Code checks** (`src/checks.ts`), on every answer:
- Hard: valid JSON; picks are input rides; no duplicates; 1 to 6 picks; reachable before close;
  never the ride's own name; rank 3+ names no other ride or position; no app vocabulary; no
  percentages, em dashes or exclamation marks; every minute/hour figure exists in the data;
  skip-verdict picks use no positive-timing words; a recently reopened ride is never "rare"; "rare"
  only when far below usual or star; restricted rides carry a note (or, if wanted, say who it affects).
- Scenario rules: each scenario's assertions from spec section 11.
- Soft: caption length, note length, busy-day opening for skip picks, "come back later" wording.

A run passes when every hard check and scenario rule passes. The spec's acceptance bar is a scenario
passing at least 4 of 5 runs.

**AI judge** (`src/judge.ts`, rules in `config/judge-rules.md`): seven pass/fail questions code
cannot check (claims match the data, present-tense picks, skip framing, restrictions, strongest
reason, voice, ranking). Judges are non-Claude Bedrock models (`config/judges.json`). They are
pointers: run `npm run judge-check` and only trust a judge that scores high there.

## Live snapshots

Score the prompt on real park data instead of the scripted scenarios:

```bash
FIREBASE_SERVICE_ACCOUNT_JSON="$(cat ../firebase-key.json)" NODE_EXTRA_CA_CERTS=$HOME/.zscaler-ca.pem \
  npm run live -- --park disneyland            # or california-adventure; --lat/--lng to stand somewhere specific
npm run eval -- --fixtures LIVE-disneyland-<stamp> --variant spec-codes --runs 3
```

`live` captures the same data the Lambda uses (park, metadata, hours, reopens, weather) as a fixture
under `live/`, anchored on the nearest operating ride to the given position (default: the park hub).
A live fixture has no scripted assertions, so the hard code checks and the AI judge are the whole
test. Note the bar: with `--runs 3` a scenario must pass 3 of 3.

## Independent second opinion

`npm run review-pack` writes `site/review/review-pack-<run>.md` from the latest run: each scenario's
situation, the real answer, the automatic check results and Judge A's verdicts, with instructions
for a reviewer. Paste it into a non-Claude chat model (ChatGPT, Gemini) to sanity-check the judge,
the checks and the scenario expectations. It replies with a JSON block that can be tallied.

## Held-out scenarios (`holdout/*.md`)

The prompt and most of the scenarios in `src/fixtures/scenarios.ts` share an author, so a prompt
change can fit them. `npm run holdout-pack` writes an authoring packet (product semantics, ride facts
with survey appeal, the block format, real captured pools; no prompt text, no harness thresholds) to
`~/.claude/specs/line-wait-ml/holdout-authoring-pack.md`. Paste it into ChatGPT or Gemini, save the
reply as `holdout/<author>-<date>.md`, and `npm run eval -- --holdout` runs those scenarios as
`H-<author>-<n>` (see `src/fixtures/holdout.ts`). Never tune the prompt on them.

## Prompt versions (`src/variants.ts`)

- `v1`: production before the spec, frozen in `src/prompts/v1/` (anchor and skip rides removed,
  UUID ids). This is the "before" for the spec's before/after numbers. It cannot pass S4 or S9 by
  design (it hides skip rides and the ride you're standing at).
- When the spec rewrite lands in `app/backend/src/recommendations`, add `spec-uuid` and `spec-codes`
  (instructions at the top of `variants.ts`; `decodeCodeName` implements spec section 5). Then
  `npm run eval -- --variant spec-codes` and compare against v1 in `site/index.html`.

## Notes and decisions

- Spec section 8 bans the words "go", "skip" and "star", but its own voice uses "Go now" and "Skip
  Rise for now". Those three are flagged only as labels ("star ride", "go verdict", "starred").
- The spec's section 12 points at `app/backend/scripts/model-bench/`; the harness now lives here.
- No temperature or other sampling parameters are sent (spec section 10).
- `results/` (raw answers) and `site/` (reports) are git-ignored. GitHub Pages sites are usually
  public and the reports contain the full prompt and answers; decide before publishing.
