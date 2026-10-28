#!/usr/bin/env bash
# Deploy the admin dashboard to Cloud Run (service club32-dashboard, us-west1).
#
#   dashboard/deploy.sh           build the site, build the image, deploy
#   dashboard/deploy.sh --setup   one-time: enable APIs, create the admin key secret
#
# The image is built from a staging dir holding only what the server needs, so
# caches (df_cache.pkl) and keys (firebase-key.json) are never uploaded.
set -euo pipefail

PROJECT=llm-wait-times
REGION=us-west1
SERVICE=club32-dashboard
IMAGE=gcr.io/$PROJECT/$SERVICE
SECRET=club32-dashboard-admin-key
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Same identity as the predict job, which already has Firestore + model bucket access.
SA="$(gcloud run jobs describe club32-predict-cron --region $REGION --project $PROJECT \
      --format='value(spec.template.spec.template.spec.serviceAccountName)')"
if [[ -z "$SA" ]]; then
  SA="$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
fi

if [[ "${1:-}" == "--setup" ]]; then
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com --project $PROJECT
  read -r -s -p "New admin key (20+ chars): " KEY; echo
  if [[ ${#KEY} -lt 20 ]]; then echo "Key too short" >&2; exit 1; fi
  printf '%s' "$KEY" | gcloud secrets create $SECRET --data-file=- --project $PROJECT
  gcloud secrets add-iam-policy-binding $SECRET --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor --project $PROJECT
  echo "Setup done. Run dashboard/deploy.sh to deploy."
  exit 0
fi

echo "== Building site"
npm --prefix "$ROOT/dashboard/web" ci
npm --prefix "$ROOT/dashboard/web" run build

echo "== Staging"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/cron" "$STAGE/models" "$STAGE/dashboard/web"
rsync -a --exclude '__pycache__' --exclude 'tests' --exclude 'experiments' "$ROOT/ml/" "$STAGE/ml/"
find "$ROOT/cron" -maxdepth 1 -name '*.py' ! -name 'test_*' -exec cp {} "$STAGE/cron/" \;
cp "$ROOT/ride_metadata.json" "$STAGE/"
cp "$ROOT/models/manifest.json" "$STAGE/models/"   # fallback if the GCS read fails
cp "$ROOT/dashboard/__init__.py" "$ROOT/dashboard/Dockerfile" "$STAGE/dashboard/"
rsync -a --exclude '__pycache__' --exclude 'tests' "$ROOT/dashboard/server/" "$STAGE/dashboard/server/"
cp -R "$ROOT/dashboard/web/dist" "$STAGE/dashboard/web/dist"
cp "$STAGE/dashboard/Dockerfile" "$STAGE/Dockerfile"
echo "staged $(du -sh "$STAGE" | cut -f1)"

echo "== Building image"
gcloud builds submit "$STAGE" --tag "$IMAGE" --project $PROJECT

echo "== Deploying"
gcloud run deploy $SERVICE --image "$IMAGE" --region $REGION --project $PROJECT \
  --service-account "$SA" \
  --allow-unauthenticated \
  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 1 --timeout 120 \
  --set-secrets "ADMIN_KEY=$SECRET:latest"

gcloud run services describe $SERVICE --region $REGION --project $PROJECT --format='value(status.url)'
