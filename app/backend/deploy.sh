#!/usr/bin/env bash
# Deploy the Club 32 backend to AWS.
#
# Prompts for the API key on every run — never stored on disk. Paste from
# your password manager. Input is hidden by `read -s`, so it won't appear
# on screen or in shell history.
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

echo "==> sam build"
sam build

echo "==> sam deploy"
sam deploy --parameter-overrides "ApiKeyValue=$API_KEY" --no-confirm-changeset

echo "==> Done."
