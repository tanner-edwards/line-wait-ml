import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pandas as pd

from day_type import holiday_features
from crowd_features import DCA_PARK_ID, DL_PARK_ID, crowd_level_ratio_live, morning_crowd_index_live
from predict import (
    HORIZONS,
    _build_full_day,
    _build_trajectory_row,
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


# ── Crowd features via crowd_features (Session 3) ───────────────────────────

def _old_crowd_level_ratio(df, now_la, hol, crowd_baselines):
    """predict.py's pre-Session-3 _compute_crowd_level_ratio, kept as the oracle."""
    from datetime import timedelta
    if now_la.hour < 10:
        return None
    cutoff_2h = now_la.astimezone(timezone.utc) - timedelta(hours=2)
    window = df[(df["timestamp_utc"] >= cutoff_2h) & (df["status"] == "OPERATING") & df["wait_minutes"].notna()]
    if window["ride_id"].nunique() < 8:
        return None
    js_dow = (now_la.weekday() + 1) % 7
    day_type = "holiday" if hol["is_holiday"] else ("weekend" if js_dow in (0, 6) else "weekday")
    expected = crowd_baselines.get(f"{day_type}_{now_la.hour}_{now_la.month}")
    return round(float(window["wait_minutes"].sum()) / float(expected), 3) if expected else None


def _old_morning_crowd_index(morning_df, now_la, morning_baselines, hol):
    """predict.py's pre-Session-3 _compute_morning_crowd_index, kept as the oracle."""
    operating = morning_df[(morning_df["status"] == "OPERATING") & morning_df["wait_minutes"].notna()]
    park_open = operating["timestamp_utc"].min()
    if (now_la.astimezone(timezone.utc) - park_open.to_pydatetime()).total_seconds() / 60 < 120:
        return None
    window = operating[operating["timestamp_utc"] <= park_open + pd.Timedelta(minutes=120)]
    js_dow = (now_la.weekday() + 1) % 7
    day_type = "holiday" if hol["is_holiday"] else ("weekend" if js_dow in (0, 6) else "weekday")
    expected = morning_baselines.get(f"{day_type}_{now_la.month}")
    return round(float(window["wait_minutes"].median()) / float(expected), 3) if expected else None


def _park_frame(start_hour, end_hour, end_minute=0):
    """9 rides per park, 10-min polls on 2026-08-24 (a Monday); DCA busier."""
    rows = []
    start = datetime(2026, 8, 24, start_hour, 0, tzinfo=LA)
    end = datetime(2026, 8, 24, end_hour, end_minute, tzinfo=LA)
    ts = start
    while ts <= end:
        for park, base in ((DL_PARK_ID, 20), (DCA_PARK_ID, 40)):
            for i in range(9):
                rows.append({
                    "ride_id": f"{park[:3]}-{i}", "park_id": park, "status": "OPERATING",
                    "timestamp_utc": pd.Timestamp(ts).tz_convert("UTC"),
                    "wait_minutes": float(base + 5 * (i % 3) + 5 * (ts.minute // 30)),
                })
        ts = ts + pd.Timedelta(minutes=10)
    return pd.DataFrame(rows)


class TestCrowdFeaturesServing:
    NOW = datetime(2026, 8, 24, 14, 5, tzinfo=LA)  # 12 polls (12:10..14:00) in the 2h window

    def test_v1_json_resort_wide_matches_old_code(self):
        df = _park_frame(12, 14)
        hol = holiday_features(self.NOW)
        v1 = {"weekday_14_8": 9000.0}
        old = _old_crowd_level_ratio(df, self.NOW, hol, v1)
        new = crowd_level_ratio_live(df, self.NOW, hol, v1)
        assert old is not None
        assert new == {DL_PARK_ID: old, DCA_PARK_ID: old}

    def test_v1_morning_json_matches_old_code(self):
        df = _park_frame(8, 14)
        hol = holiday_features(self.NOW)
        v1 = {"weekday_8": 30.0}
        old = _old_morning_crowd_index(df, self.NOW, v1, hol)
        new = morning_crowd_index_live(df, self.NOW, hol, v1)
        assert old is not None
        assert new == {DL_PARK_ID: old, DCA_PARK_ID: old}

    def test_v2_park_keyed_json_differs_per_park(self):
        df = _park_frame(12, 14)
        hol = holiday_features(self.NOW)
        v2 = {"_meta": {"keyed_by": ["park", "day_type", "hour"], "version": 2,
                        "parks": {DL_PARK_ID: "dl", DCA_PARK_ID: "dca"}},
              "dl|weekday|14": 3000.0, "dca|weekday|14": 3000.0}
        live = crowd_level_ratio_live(df, self.NOW, hol, v2)
        in_2h = df[df["timestamp_utc"] >= pd.Timestamp(self.NOW).tz_convert("UTC") - pd.Timedelta(hours=2)]
        dl_sum = in_2h[in_2h["park_id"] == DL_PARK_ID]["wait_minutes"].sum()
        dca_sum = in_2h[in_2h["park_id"] == DCA_PARK_ID]["wait_minutes"].sum()
        assert live == {DL_PARK_ID: round(dl_sum / 3000.0, 3), DCA_PARK_ID: round(dca_sum / 3000.0, 3)}
        assert live[DL_PARK_ID] != live[DCA_PARK_ID]


def _ride_history(ride_name, waits):
    start = pd.Timestamp(datetime(2026, 8, 24, 13, 0, tzinfo=LA)).tz_convert("UTC")
    return pd.DataFrame([{
        "ride_id": "hm", "ride_name": ride_name, "park_id": DL_PARK_ID, "status": "OPERATING",
        "wait_minutes": float(w), "timestamp_utc": start + pd.Timedelta(minutes=10 * i),
        "hour_of_day": 13, "day_of_week": 1, "month": 8, "is_holiday": False, "is_holiday_weekend": False,
        "days_until_next_holiday": 14, "days_since_last_holiday": 50,
    } for i, w in enumerate(waits)])


class TestRegimeWiring:
    # Holiday overlay posts 40-45 all afternoon: mid for its own band, high for the base ride's.
    THRESH = {"Haunted Mansion Holiday": {"p25": 30.0, "p75": 50.0}, "hm": {"p25": 5.0, "p75": 35.0}}
    WAITS = [20, 32, 40, 45, 40, 45, 40, 45]

    def test_name_entry_wins(self):
        row = _build_trajectory_row(_ride_history("Haunted Mansion Holiday", self.WAITS), ["hm"], ["OPERATING"], self.THRESH)
        assert row["minutes_at_current_level"] == 60.0  # 32+ is mid under (30, 50)

    def test_id_fallback_for_unknown_name(self):
        row = _build_trajectory_row(_ride_history("Haunted Mansion", self.WAITS), ["hm"], ["OPERATING"], self.THRESH)
        assert row["minutes_at_current_level"] == 50.0  # 40+ is high under (5, 35)

    def test_v1_id_keyed_json_still_works(self):
        v1 = {"hm": {"p25": 5.0, "p75": 35.0}}
        row = _build_trajectory_row(_ride_history("Haunted Mansion Holiday", self.WAITS), ["hm"], ["OPERATING"], v1)
        assert row["minutes_at_current_level"] == 50.0


class _NamedFakeBooster(_FakeBooster):
    """_FakeBooster that reports a feature list, like lgb.Booster.feature_name()."""

    def __init__(self, names):
        super().__init__()
        self._names = list(names)

    def feature_name(self):
        return self._names


class TestDayProfileColumnsFromModel:
    def _run(self, names):
        from predict import DAY_PROFILE_FEATURE_COLS
        booster = _NamedFakeBooster(names)
        slots = _build_full_day("test-ride", NOW_LA, booster, ["test-ride"], holiday_features(NOW_LA),
                                crowd_level_ratio=1.1)
        return booster.last_X, slots, DAY_PROFILE_FEATURE_COLS

    def test_pre_session3_model_with_morning_index_gets_nan(self):
        from predict import DAY_PROFILE_FEATURE_COLS
        old = list(DAY_PROFILE_FEATURE_COLS)
        old.insert(old.index("crowd_level_ratio"), "morning_crowd_index")
        assert len(old) == 18
        X, slots, _ = self._run(old)
        assert list(X.columns) == old
        assert X["morning_crowd_index"].dtype == float and X["morning_crowd_index"].isna().all()
        assert (X["crowd_level_ratio"] == 1.1).all()
        assert all(s["wait"] == 42 for s in slots)

    def test_current_model_gets_training_list(self):
        from predict import DAY_PROFILE_FEATURE_COLS
        X, _, cols = self._run(DAY_PROFILE_FEATURE_COLS)
        assert list(X.columns) == cols and len(cols) == 17
