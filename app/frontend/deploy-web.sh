#!/usr/bin/env bash
# Deploy the Club 32 PWA to S3 + CloudFront.
#
# Steps:
#   1. expo export --platform web   (produces dist/)
#   2. patch dist/index.html        (adds PWA + iOS meta tags)
#   3. aws s3 sync                  (uploads, removes deleted files)
#   4. cloudfront invalidate        (forces edge cache refresh)
#
# Reads bucket name + distribution ID from the CloudFormation stack outputs
# so this script stays portable across redeploys / re-creates of the stack.
#
# Requires:
#   - club32-backend stack must be deployed (this script reads its outputs)
#   - NODE_EXTRA_CA_CERTS set in ~/.zshrc for Zscaler trust (script reasserts it)
#   - run from app/frontend/ (the script enforces this via its own cwd)

set -euo pipefail

cd "$(dirname "$0")"

export AWS_PROFILE=club32
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$HOME/.zscaler-ca.pem}"

echo "==> Looking up bucket name + CloudFront distribution from stack outputs"
BUCKET=$(aws cloudformation describe-stacks \
  --stack-name club32-backend \
  --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue | [0]" \
  --output text)
DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name club32-backend \
  --query "Stacks[0].Outputs[?OutputKey=='WebDistributionId'].OutputValue | [0]" \
  --output text)

if [[ -z "$BUCKET" || "$BUCKET" == "None" ]]; then
  echo "Error: could not resolve WebBucketName from stack outputs." >&2
  exit 1
fi
if [[ -z "$DIST_ID" || "$DIST_ID" == "None" ]]; then
  echo "Error: could not resolve WebDistributionId from stack outputs." >&2
  exit 1
fi

echo "   Bucket:   $BUCKET"
echo "   CF dist:  $DIST_ID"

echo "==> expo export --platform web"
rm -rf dist
npx expo export --platform web

echo "==> patching dist/index.html with PWA + iOS meta tags"
node scripts/patch-html.mjs

echo "==> aws s3 sync --delete"
aws s3 sync dist/ "s3://$BUCKET" --delete

echo "==> CloudFront invalidation (forces edge cache refresh)"
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)
echo "   Invalidation: $INVALIDATION_ID"

echo "==> Done. PWA live at:"
aws cloudformation describe-stacks \
  --stack-name club32-backend \
  --query "Stacks[0].Outputs[?OutputKey=='WebDistributionUrl'].OutputValue | [0]" \
  --output text
