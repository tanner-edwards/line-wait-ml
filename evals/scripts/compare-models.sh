#!/usr/bin/env zsh
# Two-model comparison on the intent prompt (Tanner, 2026-11-21): GPT-6 Luna vs Haiku 4.5 (prod fallback).
# Each model runs the 20 scenarios x 5 and the ten live personas x 3 from each playbook starting
# spot (src/live.ts START_SPOTS, full operating pool, same seed), judged by Llama 3.3 70B and
# Sonnet 4.6. Then prints the side-by-side table.
#
# Before running: `aws login` (Bedrock: Haiku 4.5 + judges), keychain items anthropic-api-key and
# openai-api-key, ../firebase-key.json, and the park open (live sample needs operating rides).
# About 30 minutes and under $3. Usage: scripts/compare-models.sh [seed]
set -euo pipefail
cd "$(dirname "$0")/.."
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat ../firebase-key.json)"
export NODE_EXTRA_CA_CERTS="$HOME/.zscaler-ca.pem"
SEED="${1:-4242}"
JUDGES=us.meta.llama3-3-70b-instruct-v1:0,us.anthropic.claude-sonnet-4-6
PERSONAS=default,toddler,thrills,pregnant,big-kid,first-visit,wheelchair,classics,immersive,kid-fav-9
STARTS=(hub fantasyland tomorrowland neworleans frontierland galaxysedge)
typeset -a CELLS
CELLS=(
  "gpt-6-luna --reasoning none"
  "us.anthropic.claude-haiku-4-5-20251001-v1:0"
)
aws sts get-caller-identity --query Account --output text >/dev/null || { echo "AWS session expired: run aws login"; exit 1; }
before=$(ls site/data/*.json 2>/dev/null | wc -l | tr -d ' ')
for cell in "${CELLS[@]}"; do
  model="${cell%% *}"; extra="${cell#* }"; [[ "$extra" == "$cell" ]] && extra=""
  echo "=== $model scenarios"
  npm run eval -- --variant intent-codes --model "$model" ${=extra} --runs 5 --no-open --judges "$JUDGES" 2>&1 | grep -E "scenarios pass|Elapsed|FAILED"
  for start in "${STARTS[@]}"; do
    echo "=== $model live personas from $start (seed $SEED)"
    npm run eval -- --variant intent-codes --model "$model" ${=extra} --runs 3 --live disneyland --start "$start" --rides 40 --seed "$SEED" --personas "$PERSONAS" --no-open --judges "$JUDGES" 2>&1 | grep -E "^Live |scenarios pass|Elapsed|FAILED"
  done
done
new=$(( $(ls site/data/*.json | wc -l | tr -d ' ') - before ))
echo; echo "=== comparison ($new new runs)"
npm run compare -- --latest "$new"
