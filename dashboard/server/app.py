"""Club 32 admin dashboard: the built web app plus a key-gated JSON API.

    GET /api/live                     grade today (LA) so far
    GET /api/recap?date=YYYY-MM-DD    grade a past day (default: yesterday)

Every /api call needs header x-admin-key == $ADMIN_KEY. Grading runs on
request (ml/dashboard/grading.py); past days are cached in memory since they
can't change. Local run, from the repo root:

    ADMIN_KEY=dev GOOGLE_APPLICATION_CREDENTIALS=firebase-key.json \
        .venv/bin/python dashboard/server/app.py
"""

from __future__ import annotations

import hmac
import logging
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import Flask, abort, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from ml.dashboard.grading import grade_day  # noqa: E402

LA = ZoneInfo("America/Los_Angeles")
WEB_DIST = Path(os.environ.get("WEB_DIST", ROOT / "dashboard" / "web" / "dist"))
HISTORY_DAYS = 30

logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder=None)
_db = None
_recaps: dict[str, dict] = {}


def db():
    global _db
    if _db is None:
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            cred = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
            firebase_admin.initialize_app(credentials.Certificate(cred) if cred else None)
        _db = firestore.client()
    return _db


@app.before_request
def require_key():
    if not request.path.startswith("/api/"):
        return None
    expected = os.environ.get("ADMIN_KEY", "")
    provided = request.headers.get("x-admin-key", "")
    if not expected or not hmac.compare_digest(provided, expected):
        return jsonify(error="UNAUTHORIZED"), 401
    return None


@app.get("/api/live")
def live():
    return jsonify(grade_day(db(), datetime.now(LA).date()))


@app.get("/api/recap")
def recap():
    today = datetime.now(LA).date()
    try:
        day = date.fromisoformat(request.args["date"]) if "date" in request.args else today - timedelta(days=1)
    except ValueError:
        return jsonify(error="BAD_DATE"), 400
    if not (today - timedelta(days=HISTORY_DAYS) <= day < today):
        return jsonify(error="OUT_OF_RANGE", min=(today - timedelta(days=HISTORY_DAYS)).isoformat()), 400
    key = day.isoformat()
    if key not in _recaps:
        _recaps[key] = grade_day(db(), day)
    return jsonify(_recaps[key])


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def site(path):
    if path.startswith("api/"):
        abort(404)
    if path and (WEB_DIST / path).is_file():
        return send_from_directory(WEB_DIST, path)
    resp = send_from_directory(WEB_DIST, "index.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", 8080)), debug=True)
