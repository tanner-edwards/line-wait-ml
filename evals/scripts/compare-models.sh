#!/usr/bin/env zsh
# Three-model comparison on the intent prompt (Tanner, 2026-11-20): GPT-6 Luna, Haiku 5.5, Haiku 4.5.
# Each model runs the 14 scenarios x 5 and the seven live personas x 3 on one live sample (same seed),
# judged by Llama 3.3 70B and Sonnet 4.6. Then prints the side-by-side table.
#
# Before running: `aws login` (Bedrock: Haiku 4.5 + judges), keychain items anthropic-api-key and
# openai-api-key, ../firebase-key.json, and the park open (live sample needs operating rides).
# About 15 minutes and under $2. Usage: scripts/compare-models.sh [seed]
set -euo pipefail
cd "$(dirname "$0")/.."
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat ../firebase-key.json)"
export NODE_EXTRA_CA_CERTS="$HOME/.zscaler-ca.pem"
SEED="${1:-4242}"
JUDGES=us.meta.llama3-3-70b-instruct-v1:0,us.anthropic.claude-sonnet-4-6
PERSONAS=default,toddler,thrills,pregnant,big-kid,first-visit,wheelchair
typeset -a CELLS
CELLS=(
  "gpt-6-luna --reasoning none"
  "claude-haiku-5-5 --thinking off"
  "us.anthropic.claude-haiku-4-5-20251001-v1:0"
)
aws sts get-caller-identity --query Account --output text >/dev/null || { echo "AWS session expired: run aws login"; exit 1; }
before=$(ls site/data/*.json 2>/dev/null | wc -l | tr -d ' ')
for cell in "${CELLS[@]}"; do
  model="${cell%% *}"; extra="${cell#* }"; [[ "$extra" == "$cell" ]] && extra=""
  echo "=== $model scenarios"
  npm run eval -- --variant intent-codes --model "$model" ${=extra} --runs 5 --no-open --judges "$JUDGES" 2>&1 | grep -E "scenarios pass|Elapsed|FAILED"
  echo "=== $model live personas (seed $SEED)"
  npm run eval -- --variant intent-codes --model "$model" ${=extra} --runs 3 --live disneyland --seed "$SEED" --personas "$PERSONAS" --no-open --judges "$JUDGES" 2>&1 | grep -E "^Live |Sampled|scenarios pass|Elapsed|FAILED"
done
new=$(( $(ls site/data/*.json | wc -l | tr -d ' ') - before ))
echo; echo "=== comparison ($new new runs)"
npm run compare -- --latest "$new"
