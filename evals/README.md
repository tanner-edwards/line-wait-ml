# evals: repeatable evaluation of the recommendations prompt

Separate from the app. Measures the `/v2/recommendations` LLM call (speed, rule-following, and
advice quality) so prompt and pipeline changes can be judged by numbers, not vibes.
It imports the real prompt builders from `app/backend/src/recommendations`, so `baseline`
is exactly what production sends.

```
evals/
  src/scenarios.ts   test situations + rule checks (add yours here)
  src/variants.ts    prompt experiments (baseline, short-ids, tight-copy, ...)
  src/bench.ts       runner: variant x scenarios x runs on a Bedrock model
  src/compare.ts     candidate vs baseline: speed + rules + blind automatic judging
  src/eval-pack.ts   manual path: anonymized pack for human/other-agent evaluators
  src/llm.ts         Bedrock calls (+ --mock offline mode)
  config/            models.json (finalists), judges.json
  results/           saved runs and reports (git-ignored)
```

## Setup (once)

```bash
cd evals && npm install
export AWS_REGION=us-west-2          # plus your usual AWS credentials / AWS_PROFILE
npm run dry-run                      # no AWS: checks fixtures, rule checks and every variant
npm run bench -- --mock --runs 1     # whole pipeline offline with fake answers (free)
```

## The loop: improve Haiku

```bash
# 1. Measure the current prompt (production model = Haiku 4.5)
npm run bench -- --variant baseline --runs 5

# 2. Measure an experiment
npm run bench -- --variant short-ids --runs 5

# 3. Compare, with automatic blind judging by non-Claude Bedrock models
npm run compare -- results/baseline-<stamp>.json results/short-ids-<stamp>.json
```

`compare` prints a verdict and writes a Markdown report plus a JSON summary next to it:
speed (p50/p95, output tokens), rule-check pass rates, and how often blind judges preferred the
candidate, per scenario. Each pair is judged twice with the answer order swapped to cancel
position bias. Judges are in `config/judges.json` (keep them non-Claude so Haiku does not grade
its own style). Rough cost: ~150 Haiku calls per run plus ~100 cheap judge calls.

## Adding an experiment

Add one object to `src/variants.ts` (build the system prompt and user message; add `decode` if
you rename ride ids) and register it. `npm run dry-run` verifies it builds and round-trips ids.
When a variant wins, port it into `app/backend/src/recommendations/promptBuilder.ts` (and
`handler.ts` if parsing changes).

## Useful commands

| Goal | Command |
|---|---|
| Different model | `npm run bench -- --models <bedrock-id>` |
| All finalist models | `npm run bench -- --all-models` |
| Subset of scenarios | `npm run bench -- --scenarios toddler-family,pregnant-guest` |
| Re-grade saved answers after editing checks (no AWS) | `npm run bench -- --rescore results/x.json` |
| Re-print a summary | `npm run bench -- --report results/x.json` |
| Cap a slow model | `--timeout-ms 45000`, `--skip-if-slower-than 10000` |

## What the checks mean

- **Hard rules** (`src/scenarios.ts`): wrong output for the guest, such as a height-restricted ride
  for a toddler, the current ride included, an invalid ride id, a star deal not surfaced.
- **Copy rules**: caption length (<= 80 chars), no internal jargon, does not restate wait or ride name.
- **Judges** assess what rules cannot: whether claims match the data, whether the order suits the
  guest, whether the caption is actually useful.

## Manual multi-agent evaluation (optional)

For an independent read from other AI chat tools, build an anonymized pack from saved runs:

```bash
npm run pack -- build results/run.json --models <ids>        # writes results/pack/evaluation-pack.md + key
npm run pack -- report results/pack/evaluation-key.json evalA.json evalB.json
```

Give `evaluation-pack.md` to the evaluators; keep `evaluation-key.json` private. Use this
occasionally to sanity-check the automatic judges.

## Roadmap

1. Many more scenarios, including real snapshots captured from production.
2. A PR workflow that runs `bench` + `compare` when prompt files change and posts the report.
3. Publish each run's JSON summary to GitHub Pages for a browsable history.
