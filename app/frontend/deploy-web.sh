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

# Upload in two passes so the browser/PWA gets correct Cache-Control headers:
#
#   1. `sync` everything with long-immutable caching. Expo hashes JS/CSS
#      filenames (e.g. entry-abc123.js), so when content changes the URL
#      changes — safe to cache for a year.
#   2. `cp` over index.html and sw.js with no-cache so the browser always
#      re-fetches the entry point + service worker on every load. Without
#      this, CloudFront's CachingOptimized policy falls back to a 1-day
#      browser TTL and users keep seeing the old PWA after a deploy.
echo "==> aws s3 sync --delete (long-immutable cache for hashed assets)"
aws s3 sync dist/ "s3://$BUCKET" --delete \
  --cache-control "public, max-age=31536000, immutable"

echo "==> aws s3 cp index.html + sw.js (no-cache override)"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html"
if [[ -f dist/sw.js ]]; then
  aws s3 cp dist/sw.js "s3://$BUCKET/sw.js" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "application/javascript"
fi

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
