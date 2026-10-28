from datetime import datetime, timedelta

import pytest

from dashboard.server import app as server


@pytest.fixture
def client(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html>dash</html>")
    (tmp_path / "app.js").write_text("js")
    monkeypatch.setattr(server, "WEB_DIST", tmp_path)
    monkeypatch.setenv("ADMIN_KEY", "secret")
    calls = []
    monkeypatch.setattr(server, "db", lambda: None)
    monkeypatch.setattr(server, "grade_day", lambda db, day: calls.append(day) or {"date": day.isoformat()})
    monkeypatch.setattr(server, "_recaps", {})
    c = server.app.test_client()
    c.calls = calls
    return c


KEY = {"x-admin-key": "secret"}


def test_api_requires_key(client):
    assert client.get("/api/live").status_code == 401
    assert client.get("/api/live", headers={"x-admin-key": "wrong"}).status_code == 401
    assert client.get("/api/live", headers=KEY).status_code == 200


def test_no_key_configured_rejects_everything(client, monkeypatch):
    monkeypatch.setenv("ADMIN_KEY", "")
    assert client.get("/api/live", headers={"x-admin-key": ""}).status_code == 401


def test_recap_defaults_to_yesterday_and_caches(client):
    yesterday = (datetime.now(server.LA).date() - timedelta(days=1)).isoformat()
    assert client.get("/api/recap", headers=KEY).get_json()["date"] == yesterday
    client.get(f"/api/recap?date={yesterday}", headers=KEY)
    assert len(client.calls) == 1


def test_recap_rejects_today_bad_and_old_dates(client):
    today = datetime.now(server.LA).date()
    assert client.get(f"/api/recap?date={today}", headers=KEY).status_code == 400
    assert client.get("/api/recap?date=nope", headers=KEY).status_code == 400
    assert client.get(f"/api/recap?date={today - timedelta(days=31)}", headers=KEY).status_code == 400


def test_site_is_public_with_spa_fallback(client):
    assert client.get("/app.js").data == b"js"
    r = client.get("/some/deep/link")
    assert r.status_code == 200 and b"dash" in r.data
    assert client.get("/api/nope", headers=KEY).status_code == 404
