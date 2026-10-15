import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pandas as pd

from day_type import holiday_features
from predict import (
    HORIZONS,
    _build_full_day,
    _derive_trend,
    _read_model_version,
    _tombstone_doc,
)
from test_predict_full_day import _FakeBooster

LA = ZoneInfo("America/Los_Angeles")
NOW_LA = datetime(2026, 8, 24, 12, 0, tzinfo=LA)
NOW_MINUTES = 12 * 60


def _morning_row(hour, minute, raw, ride_id="test-ride", status="OPERATING"):
    return {
        "ride_id": ride_id,
        "status": status,
        "timestamp_utc": pd.Timestamp(datetime(2026, 8, 24, hour, minute, tzinfo=LA)).tz_convert("UTC"),
        "wait_minutes_raw": raw,
    }


def _morning_df():
    return pd.DataFrame([
        _morning_row(8, 5, 13),
        _morning_row(8, 15, 13),
        _morning_row(9, 5, 20),
        _morning_row(9, 15, 30),
        # Other rides and non-OPERATING rows must not leak into this ride's slots.
        _morning_row(9, 45, 90, ride_id="other-ride"),
        _morning_row(9, 45, 60, status="DOWN"),
    ])


def _call(morning_df=None, now_minutes=None, current_raw_wait=None):
    return _build_full_day(
        "test-ride", NOW_LA, _FakeBooster(), ["test-ride"], holiday_features(NOW_LA),
        morning_df=morning_df, now_minutes=now_minutes, current_raw_wait=current_raw_wait,
    )


def _by_start(slots):
    return {s["start_minutes"]: s["wait"] for s in slots}


class TestFullDayActuals:
    def test_past_current_and_future_slot_sourcing(self):
        slots = _by_start(_call(_morning_df(), NOW_MINUTES, current_raw_wait=55))
        assert slots[8 * 60] == 13            # raw walk-on value, not normalized
        assert slots[9 * 60] == 25            # median of 20 and 30
        assert slots[9 * 60 + 30] is None     # no OPERATING rows for this ride
        assert slots[7 * 60] is None          # before park open
        assert slots[11 * 60 + 30] is None    # 11:30-12:00 ended at 12:00 → past, no rows
        assert slots[12 * 60] == 55           # slot containing now = current raw wait
        assert slots[12 * 60 + 30] == 42      # future → model

    def test_current_slot_keeps_model_value_when_current_wait_unknown(self):
        slots = _by_start(_call(_morning_df(), NOW_MINUTES, current_raw_wait=None))
        assert slots[12 * 60] == 42

    def test_no_morning_df_leaves_every_slot_as_model(self):
        slots = _call(None, NOW_MINUTES, current_raw_wait=55)
        assert all(s["wait"] == 42 for s in slots)


class TestFullDayActualsMidSlot:
    def test_slot_containing_now_mid_window(self):
        # now = 11:40 → the 11:30 slot contains now.
        slots = _by_start(_call(_morning_df(), 11 * 60 + 40, current_raw_wait=55))
        assert slots[11 * 60 + 30] == 55
        assert slots[11 * 60] is None
        assert slots[12 * 60] == 42


class TestDeriveTrendConfidence:
    LATER = [40, 50, 60, 90, 120, 150, 180, 210, 240]

    def test_t10_t20_t30_do_not_affect_count(self):
        # delta30 = +10 (t30 drives it). Of the 9 horizons after T+30, six
        # agree (+) and three disagree (-) -> medium. Counting t10/t20/t30 (all +)
        # too would make it 9 of 12 and read as high.
        preds = {10: 40.0, 20: 40.0, 30: 40.0}
        preds.update({h: (40.0 if i < 6 else 20.0) for i, h in enumerate(self.LATER)})
        trend, delta30, confidence = _derive_trend(30.0, 30.0, preds)
        assert delta30 == 10.0
        assert confidence == "medium"

    def test_t10_t20_disagreeing_change_nothing(self):
        base = {10: 40.0, 20: 40.0, 30: 40.0}
        base.update({h: 40.0 for h in self.LATER})
        flipped = {**base, 10: 10.0, 20: 10.0}
        assert _derive_trend(30.0, 30.0, base)[2] == _derive_trend(30.0, 30.0, flipped)[2] == "high"

    def test_seven_of_nine_is_high_six_is_medium(self):
        preds7 = {10: 40.0, 20: 40.0, 30: 40.0}
        preds7.update({h: (40.0 if i < 7 else 20.0) for i, h in enumerate(self.LATER)})
        assert _derive_trend(30.0, 30.0, preds7)[2] == "high"
        preds4 = {10: 40.0, 20: 40.0, 30: 40.0}
        preds4.update({h: (40.0 if i < 4 else 20.0) for i, h in enumerate(self.LATER)})
        assert _derive_trend(30.0, 30.0, preds4)[2] == "low"


class TestTombstone:
    def test_shape(self):
        now = datetime(2026, 8, 24, 19, 0, tzinfo=timezone.utc)
        assert _tombstone_doc("ride-1", now, "2026-10-04") == {
            "ride_id": "ride-1",
            "updated_at": now.isoformat(),
            "degraded": True,
            "degraded_reason": "insufficient_history",
            "model_version": "2026-10-04",
        }


class TestReadModelVersion:
    def test_reads_trained_through(self, tmp_path):
        (tmp_path / "manifest.json").write_text(json.dumps({"trained_through": "2026-10-04", "recipe": "A"}))
        assert _read_model_version(tmp_path) == "2026-10-04"

    def test_missing_file_is_unknown(self, tmp_path):
        assert _read_model_version(tmp_path) == "unknown"

    def test_bad_json_is_unknown(self, tmp_path):
        (tmp_path / "manifest.json").write_text("{not json")
        assert _read_model_version(tmp_path) == "unknown"

    def test_missing_key_is_unknown(self, tmp_path):
        (tmp_path / "manifest.json").write_text(json.dumps({"recipe": "A"}))
        assert _read_model_version(tmp_path) == "unknown"
