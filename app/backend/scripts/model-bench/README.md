# Bedrock model benchmark

Compares Bedrock models on the real `/v2/recommendations` prompt: speed **and** answer quality.

It reuses `buildSystemPrompt`, `buildUserMessage` and `personaToText` from `src/recommendations`, so
every model sees exactly what production sends. Calls use the Converse API, so any Bedrock model
family works with no per-model request formatting.

## Run

From `app/backend` (AWS credentials in the environment or `AWS_PROFILE`):

```bash
# 1. No AWS calls: validates fixtures and proves every check can fail
npx tsx scripts/model-bench/bench.ts --dry-run

# 2. Quick smoke test of one model
npx tsx scripts/model-bench/bench.ts --models us.anthropic.claude-haiku-4-5-20251001-v1:0 --runs 1

# 3. Full comparison of everything in models.json, saved to disk
npx tsx scripts/model-bench/bench.ts --runs 5 --out scripts/model-bench/results/run1.json

# Optional: have a stronger model grade ranking + copy quality (1-5)
npx tsx scripts/model-bench/bench.ts --runs 3 --judge us.anthropic.claude-sonnet-4-5-20250929-v1:0
```

Flags: `--models a,b` | `--models-file f.json` | `--scenarios id1,id2` | `--runs N` | `--region` |
`--temperature` (unset by default, matching production) | `--max-tokens` | `--judge <modelId>` | `--out`.

## What it reports

- **Latency**: wall-clock p50 / p95 / mean per call (what the Lambda waits), output tokens, tokens/sec.
  Each model gets one discarded warm-up call. Throttling retries are excluded from timings.
- **json ok %**: output parsed as the strict schema.
- **hard pass %**: persona/ranking/rule checks (e.g. toddler gets no height-restricted rides in the top 3,
  the closer of two equal headliners ranks first, prompt injection yields an empty list, never recommends
  the current ride).
- **soft pass %**: copy rules (<= 80 chars, no internal jargon, doesn't restate wait/ride name).
- **judge rank / copy** (only with `--judge`).

Pick the fastest model whose **hard pass %** is at your bar (compare against the current production
model's number), then confirm on a larger `--runs`.

## Adding scenarios

Add an entry to `SCENARIOS` in `scenarios.ts` with a persona, clock, ride board, and checks.
`--dry-run` fails if a check can never fail, which catches vacuous tests.

## Non-Bedrock providers (OpenAI, Gemini) — optional, not in the default run

Bedrock only hosts OpenAI's open-weight `gpt-oss` models, not GPT-5.x/4.x or Gemini, so those are
called directly. Prefix the id in `models.json`: `openai:<model>` or `gemini:<model>`.

```bash
export OPENAI_API_KEY=...   GEMINI_API_KEY=...
npx tsx scripts/model-bench/bench.ts --list-models openai    # confirm real, current model ids
npx tsx scripts/model-bench/bench.ts --list-models gemini
```

Caveats when comparing:
- These calls go over the public internet, not your AWS region, so latency includes a network path
  Bedrock doesn't. Run from the same place your Lambda would to keep it fair.
- Reasoning/"thinking" models can spend seconds on hidden tokens. Try `--reasoning-effort minimal`
  (OpenAI) and `--gemini-thinking-budget 0` (Gemini) for the fast configuration, and compare to defaults.
- `docs/legal/privacy-policy.html` says recommendations are processed through Amazon Bedrock. Switching
  providers means updating that policy and the Lambda (the app currently only has a Bedrock client).

Note: model IDs in `models.json` are starting points; confirm they exist for your account/region.
The OpenAI/Gemini names were best guesses from web results, not verified against the APIs.
