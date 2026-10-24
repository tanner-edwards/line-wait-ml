# Built by dashboard/deploy.sh from a staging dir (never the repo root, so
# caches and keys can't be uploaded). Layout inside the image mirrors the repo
# so ml/clean.py and ml/dashboard find cron/ through their own sys.path logic.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY dashboard/server/requirements.txt dashboard/server/requirements.txt
RUN pip install --no-cache-dir -r dashboard/server/requirements.txt
COPY . .
ENV WEB_DIST=/app/dashboard/web/dist
CMD exec gunicorn --bind :$PORT --workers 1 --threads 4 --timeout 120 dashboard.server.app:app
