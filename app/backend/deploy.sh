#!/usr/bin/env bash
# Deploy the Club 32 backend to AWS.
#
# Prompts for the API key on every run — never stored on disk. Paste from
# your password manager. Input is hidden by `read -s`, so it won't appear
# on screen or in shell history.
#
# Reads the CloudFront URL out of the deployed stack's outputs and pins it
# as the CORS origin. If the stack doesn't have a CloudFront distribution
# yet (very first deploy), falls back to "*" so the bootstrap works.
#
# Requires:
#   - aws-cli configured with a 'club32' profile (see Phase 0 setup)
#   - sam-cli installed
#   - run from app/backend/ (the script enforces this via its own cwd)

set -euo pipefail

# Always run from the script's own directory so callers can invoke from anywhere
cd "$(dirname "$0")"

export AWS_PROFILE=club32

echo "==> Paste the Club 32 API key (input hidden):"
read -rs API_KEY
echo

if [[ -z "$API_KEY" ]]; then
  echo "Error: empty API key. Aborting." >&2
  exit 1
fi

if [[ ${#API_KEY} -lt 20 ]]; then
  echo "Error: API key is shorter than 20 chars. The template enforces a 20-char minimum; aborting before SAM rejects it." >&2
  exit 1
fi

# Firebase service-account credential. Loaded from firebase-key.json at the
# repo root (gitignored, same file the collector uses). We bypass shell paste
# entirely because the JSON is ~2.3KB minified, which exceeds many terminals'
# silent paste limits. Override the path with FIREBASE_KEY_PATH if you keep
# the file elsewhere.
FIREBASE_KEY_PATH="${FIREBASE_KEY_PATH:-../../firebase-key.json}"

if [[ ! -f "$FIREBASE_KEY_PATH" ]]; then
  echo "Error: Firebase service-account file not found at $FIREBASE_KEY_PATH" >&2
  echo "       Set FIREBASE_KEY_PATH or place firebase-key.json at the repo root." >&2
  exit 1
fi

# Base64-encode so SAM CLI's --parameter-overrides parser doesn't choke on
# the inner quotes / equals signs / etc in the JSON. The Lambda's
# firestoreClient.ts decodes it on read. base64 keeps the value shell-safe
# at the cost of ~33% length inflation (still well under SAM's limits).
FIREBASE_JSON_B64=$(python3 -c "
import json, base64
with open('$FIREBASE_KEY_PATH') as f:
    minified = json.dumps(json.load(f))
print(base64.b64encode(minified.encode('utf-8')).decode('ascii'))
" 2>/dev/null) || {
  echo "Error: $FIREBASE_KEY_PATH did not parse as JSON. Aborting." >&2
  exit 1
}

if [[ -z "$FIREBASE_JSON_B64" || ${#FIREBASE_JSON_B64} -lt 100 ]]; then
  echo "Error: base64-encoded Firebase JSON is empty or implausibly short. Aborting." >&2
  exit 1
fi

echo "==> Loaded Firebase service-account from $FIREBASE_KEY_PATH (${#FIREBASE_JSON_B64} chars base64)"

# Look up the current stack's CloudFront URL so CORS pins to it.
# Returns "None" if the stack doesn't exist yet or the output isn't present.
CORS_ORIGIN=$(aws cloudformation describe-stacks \
  --stack-name club32-backend \
  --query "Stacks[0].Outputs[?OutputKey=='WebDistributionUrl'].OutputValue | [0]" \
  --output text 2>/dev/null || echo "None")

if [[ "$CORS_ORIGIN" == "None" || -z "$CORS_ORIGIN" ]]; then
  CORS_ORIGIN='*'
  echo "==> No CloudFront URL in stack yet — bootstrapping with CorsOrigin='*'"
else
  echo "==> CorsOrigin pinned to $CORS_ORIGIN"
fi

echo "==> sam build"
sam build

# v2 Bedrock params. Override BEDROCK_MODEL_ID before running this script to
# swap models without editing template.yaml. BEDROCK_BUDGET_ALARM_EMAIL is
# optional — when set, the stack provisions an SNS topic + CloudWatch alarm
# that triggers when monthly Bedrock spend exceeds $10. AWS sends a one-time
# confirmation email the first time it's set; click the link or the alarm
# won't route.
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-us.anthropic.claude-haiku-4-5-20251001-v1:0}"
BEDROCK_REGION="${BEDROCK_REGION:-us-west-2}"
BEDROCK_BUDGET_ALARM_EMAIL="${BEDROCK_BUDGET_ALARM_EMAIL:-}"

echo "==> Bedrock model: $BEDROCK_MODEL_ID (region $BEDROCK_REGION)"
if [[ -n "$BEDROCK_BUDGET_ALARM_EMAIL" ]]; then
  echo "==> Budget alarm will notify: $BEDROCK_BUDGET_ALARM_EMAIL"
else
  echo "==> Budget alarm skipped (set BEDROCK_BUDGET_ALARM_EMAIL to enable)"
fi

# SAM's shorthand --parameter-overrides format rejects empty values
# (`Key=` without a value), so only append the budget-email param when
# it's actually set. When omitted, the template default ('') leaves the
# alarm resources unprovisioned via the HasBudgetEmail condition.
PARAMETER_OVERRIDES=(
  "ApiKeyValue=$API_KEY"
  "CorsOrigin=$CORS_ORIGIN"
  "FirebaseServiceAccountJson=$FIREBASE_JSON_B64"
  "BedrockModelId=$BEDROCK_MODEL_ID"
  "BedrockRegion=$BEDROCK_REGION"
)
if [[ -n "$BEDROCK_BUDGET_ALARM_EMAIL" ]]; then
  PARAMETER_OVERRIDES+=("BedrockBudgetAlarmEmail=$BEDROCK_BUDGET_ALARM_EMAIL")
fi
# Opt-in ONLY for a dev/demo backend: unlocks premium for anonymous users
# (the web sign-in path). Leave unset for prod so the paywall holds — the
# template default is 'false'.
if [[ "${ALLOW_ANONYMOUS_PREMIUM:-}" == "true" ]]; then
  PARAMETER_OVERRIDES+=("AllowAnonymousPremium=true")
  echo "==> WARNING: AllowAnonymousPremium=true — anonymous users get premium. Dev/demo only, never prod."
fi

echo "==> sam deploy"
sam deploy \
  --parameter-overrides "${PARAMETER_OVERRIDES[@]}" \
  --no-confirm-changeset

echo "==> Done."
