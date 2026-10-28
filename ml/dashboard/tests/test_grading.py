import json
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

from ml.dashboard import grading

LA = ZoneInfo("America/Los_Angeles")
DL = "7340550b-c14d-4def-80bb-acdb51d49a66"
DAY = date(2026, 10, 21)  # a Wednesday, not a holiday
CONFIG = {
    "bellwethers": {DL: ["a"]},
    "park_names": {DL: "Disneyland"},
    "horizons": [30, 60, 240],
    "tolerance_min": {"30": 5, "60": 10, "240": 15},
    "match_slack_min": 5,
    "big_miss_min": 15,
    "big_miss_horizon": 30,
    "closing_window_min": 60,
    "post_reopen_window_min": 60,
}


def _at(hour, minute=0):
    return datetime(2026, 10, 21, hour, minute, tzinfo=LA).astimezone(timezone.utc)


def _wait_a(i):
    """Ride a: climbs 5 min per poll from 20."""
    return 20.0 + 5 * i


def _docs(n=25, version_at=None, ride_b_down=range(0), fall_call_at=None):
    """Polls every 10 min from 10:00 LA. Ride a's forecasts are perfect;
    ride b is flat at 30 with a forecast of 40 (always 10 off)."""
    docs = []
    for i in range(n):
        t = _at(10) + timedelta(minutes=10 * i)
        version = "v2" if version_at is not None and i >= version_at else "v1"
        a = {"name": "Ride A", "status": "OPERATING", "wait": _wait_a(i), "wait_raw": _wait_a(i),
             "seen_at": t, "tombstone": False, "trend": "rising", "trend_source": "classifier",
             "p_rise_30": 0.8, "p_fall_30": 0.05}
        for h in CONFIG["horizons"]:
            a[f"t{h}"] = _wait_a(i + h // 10)
        if fall_call_at is not None and i == fall_call_at:
            a["p_fall_30"] = 0.9
        down = i in ride_b_down
        b = {"name": "Ride B", "status": "DOWN" if down else "OPERATING", "wait": None if down else 30.0,
             "wait_raw": None if down else 30.0, "seen_at": t, "tombstone": down}
        if not down:
            b.update({f"t{h}": 40.0 for h in CONFIG["horizons"]})
            b.update({"trend": "stable", "trend_source": "classifier", "p_rise_30": 0.1, "p_fall_30": 0.1})
        docs.append({"park_id": DL, "run_at": t, "date_la": DAY.isoformat(), "model_version": version,
                     "rides": {"a": a, "b": b}})
    return docs


def _schedules(close_hour=22):
    return pd.DataFrame([{
        "entries": [{"type": "OPERATING", "openingTime": "2026-10-21T08:00:00-07:00",
                     "closingTime": f"2026-10-21T{close_hour}:00:00-07:00"}],
        "parkName": "Disneyland Park", "parkId": DL, "date": DAY.isoformat(),
    }])


def _grade(docs, closures=(), manifest=None, baselines=None, schedules=None):
    return grading.grade(docs, _schedules() if schedules is None else schedules, list(closures), [],
                         manifest or {}, baselines or {}, {}, DAY, CONFIG)["parks"][DL]


class TestRunsFrame:
    def test_poll_recorded_twice_keeps_one_row(self):
        docs = _docs(3)
        dup = json.loads(json.dumps(docs[-1], default=str))
        dup["run_at"] = docs[-1]["run_at"] + timedelta(minutes=2)
        dup["rides"]["a"]["seen_at"] = docs[-1]["rides"]["a"]["seen_at"]
        df = grading.runs_frame(docs + [dup])
        assert len(df[df["ride_id"] == "a"]) == 3

    def test_stale_poll_is_dropped(self):
        docs = _docs(2)
        docs[1]["rides"]["a"]["seen_at"] = docs[1]["run_at"] - timedelta(minutes=40)
        df = grading.runs_frame(docs)
        assert len(df[df["ride_id"] == "a"]) == 1


class TestMatching:
    def test_perfect_forecasts_score_zero_and_beat_persistence(self):
        head = {h["horizon"]: h for h in _grade(_docs())["headline"]}
        # ride a is perfect, ride b is always 10 off: MAE = 5 on balanced rows
        assert head[30]["mae"] == pytest.approx(5.0)
        assert head[30]["mae_persistence"] > 0
        assert head[30]["hit_rate"] == pytest.approx(0.5)  # a within 5, b not

    def test_persistence_scored_on_identical_rows(self):
        df = grading.runs_frame(_docs())
        m = grading.match_forecasts(df, [30], 5)
        a = m[m["ride_id"] == "a"]
        assert (a["abs_err_persist"] == 15.0).all()  # +3 polls of +5 each

    def test_unmatched_tail_is_dropped(self):
        df = grading.runs_frame(_docs(n=25))  # 4 h of polls
        m = grading.match_forecasts(df, [240], 5)
        assert len(m[m["ride_id"] == "a"]) == 1  # only the first poll has an actual 4 h later

    def test_down_actuals_and_down_origins_are_not_graded(self):
        # ride b is DOWN at 10:30, 10:40, 10:50
        df = grading.runs_frame(_docs(ride_b_down=range(3, 6)))
        origins = set(grading.match_forecasts(df, [30], 5).query("ride_id == 'b'")["timestamp_utc"])
        for hm in ((10, 0), (10, 10), (10, 20)):  # T+30 lands on a DOWN poll
            assert _at(*hm) not in origins
        for hm in ((10, 30), (10, 40), (10, 50)):  # origin itself is DOWN
            assert _at(*hm) not in origins
        assert _at(11, 0) in origins


class TestSlicesAndVersions:
    def test_closing_window(self):
        out = _grade(_docs(), schedules=_schedules(close_hour=14))
        closing = {h["horizon"]: h for h in out["slices"]["closing"]}
        # targets in (13:00, 14:00]: origins 12:40-13:30, 6 polls x 2 rides
        assert closing[30]["n"] == 12
        assert closing[240]["n"] == 2  # 10:00 -> 14:00, exactly at close, both rides

    def test_after_close_rows_are_cleaned(self):
        # Polls run to 14:00; a 12:00 close drops everything after noon.
        out = _grade(_docs(), schedules=_schedules(close_hour=12))
        assert out["last_poll"] == _at(12).isoformat()

    def test_post_reopen_slice(self):
        closure = {"rideId": "a", "rideName": "Ride A", "parkId": DL, "closedAt": _at(10, 30).isoformat(),
                   "reopenedAt": _at(11).isoformat(), "durationMin": 30.0, "waitAtClose": 30, "waitAtReopen": 40}
        out = _grade(_docs(), closures=[closure])
        post = {h["horizon"]: h for h in out["slices"]["post_reopen"]}
        assert post[30]["n"] > 0
        assert out["closures"][0]["recovery"][0]["min_after"] == 0

    def test_version_split_and_deploy_marker(self):
        out = _grade(_docs(version_at=12))
        assert out["model_versions"] == ["v1", "v2"]
        assert [d["model_version"] for d in out["deploy_markers"]] == ["v2"]
        assert {v["model_version"] for v in out["by_model_version"]} == {"v1", "v2"}


class TestAnomalies:
    MANIFEST = {"trend_thresholds": {"15-25": {"high": {"fall": 0.76}}, "30-60": {"high": {"fall": 0.6}},
                                     ">60": {"high": {"fall": 0.75}}, "<=10": {"high": {"fall": None}}}}

    def test_fall_call_is_graded(self):
        out = _grade(_docs(fall_call_at=4), manifest=self.MANIFEST)  # wait 40 at 10:40, keeps rising
        calls = [a for a in out["anomalies"] if a["type"] == "fall_call"]
        assert len(calls) == 1
        assert calls[0]["threshold"] == 0.6
        assert calls[0]["fell"] is False

    def test_no_thresholds_no_fall_calls(self):
        out = _grade(_docs(fall_call_at=4))
        assert not [a for a in out["anomalies"] if a["type"] == "fall_call"]

    def test_unusual_vs_hour_band(self):
        bands = {f"Ride B|weekday|{h}": {"p10": 35.0, "p90": 50.0} for h in range(10, 15)}
        out = _grade(_docs(), baselines={"hour_bands": bands})
        low = [a for a in out["anomalies"] if a["type"] == "unusual" and a["ride_name"] == "Ride B"]
        assert len(low) == 1 and low[0]["side"] == "low"  # one episode, not one per poll

    def test_unusual_margin_and_min_polls(self):
        # Ride B sits at 30 all day: 5 below a 35 floor is inside a 10-min margin.
        bands = {f"Ride B|weekday|{h}": {"p10": 35.0, "p90": 50.0} for h in range(10, 15)}
        out = grading.grade(_docs(), _schedules(), [], [], {}, {"hour_bands": bands}, {}, DAY,
                            {**CONFIG, "unusual_margin_min": 10, "unusual_min_polls": 2})["parks"][DL]
        assert not [a for a in out["anomalies"] if a["type"] == "unusual"]
        bands = {f"Ride B|weekday|{h}": {"p10": 45.0, "p90": 50.0} for h in range(10, 15)}
        out = grading.grade(_docs(), _schedules(), [], [], {}, {"hour_bands": bands}, {}, DAY,
                            {**CONFIG, "unusual_margin_min": 10, "unusual_min_polls": 2})["parks"][DL]
        assert len([a for a in out["anomalies"] if a["type"] == "unusual"]) == 1  # 15 below

    def test_big_miss(self):
        docs = _docs()
        docs[2]["rides"]["a"]["t30"] = 100.0
        misses = [a for a in _grade(docs)["anomalies"] if a["type"] == "big_miss"]
        assert len(misses) == 1 and misses[0]["forecast"] == 100.0


class TestCrowdAndPayload:
    def test_crowd_null_with_too_few_rides(self):
        baselines = {"crowd": {"_meta": {"keyed_by": ["park", "day_type", "hour"], "version": 2,
                                         "parks": {DL: "dl"}},
                               **{f"dl|weekday|{h}": 100.0 for h in range(8, 23)}}}
        out = _grade(_docs(), baselines=baselines)
        assert out["crowd"]["ratio"] and all(p["ratio"] is None for p in out["crowd"]["ratio"])  # 2 rides < 8

    def test_payload_is_json_serializable(self):
        payload = grading.grade(_docs(fall_call_at=4), _schedules(), [], [], TestAnomalies.MANIFEST,
                                {}, {}, DAY, CONFIG)
        json.dumps(payload, allow_nan=False)

    def test_empty_day(self):
        out = grading.grade([], _schedules(), [], [], {}, {}, {}, DAY, CONFIG)["parks"][DL]
        assert out["runs"] == 0 and out["headline"][0]["n"] == 0 and out["bellwethers"][0]["actual"] == []
