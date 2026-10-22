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
    _curve_confidence,
    _derive_trend,
    _derive_trend_from_probs,
    _load_models,
    _model_files,
    _predict_classifiers,
    _predict_trajectory,
    _read_manifest,
    _tombstone_doc,
    TRAJECTORY_FEATURE_COLS,
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
        trend, delta30, confidence, source = _derive_trend(30.0, 30.0, preds)
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
    NOW = datetime(2026, 8, 24, 19, 0, tzinfo=timezone.utc)

    def test_full_shape(self):
        # Full doc shape so a backend that reads full_day.length / t* without
        # checking `degraded` still gets a readable doc.
        expected = {"ride_id": "ride-1", "updated_at": self.NOW.isoformat()}
        expected.update({f"t{h}": 35.0 for h in HORIZONS})
        expected.update({
            "trend": "stable",
            "trend_delta_30": 0.0,
            "confidence": "low",
            "curve_confidence": "low",
            "full_day": [],
            "degraded": True,
            "degraded_reason": "insufficient_history",
            "model_version": "2026-10-04",
        })
        assert _tombstone_doc("ride-1", self.NOW, "2026-10-04", 35.0) == expected

    def test_every_horizon_equals_current_wait(self):
        doc = _tombstone_doc("ride-1", self.NOW, "v", 13.0)
        assert [doc[f"t{h}"] for h in HORIZONS] == [13.0] * len(HORIZONS)
        assert all(isinstance(doc[f"t{h}"], float) for h in HORIZONS)
        assert "reversion_prob" not in doc and "pct_rank" not in doc

    def test_unknown_wait_is_zero(self):
        doc = _tombstone_doc("ride-1", self.NOW, "v", None)
        assert [doc[f"t{h}"] for h in HORIZONS] == [0.0] * len(HORIZONS)


class TestReadManifest:
    def test_reads_fields(self, tmp_path):
        (tmp_path / "manifest.json").write_text(json.dumps(
            {"trained_through": "2026-10-04", "recipe": "B", "trajectory_target": "delta"}))
        m = _read_manifest(tmp_path)
        assert m["trained_through"] == "2026-10-04" and m["trajectory_target"] == "delta"

    def test_missing_file_is_empty(self, tmp_path):
        assert _read_manifest(tmp_path) == {}

    def test_bad_json_is_empty(self, tmp_path):
        (tmp_path / "manifest.json").write_text("{not json")
        assert _read_manifest(tmp_path) == {}

    def test_non_object_is_empty(self, tmp_path):
        (tmp_path / "manifest.json").write_text("[1, 2]")
        assert _read_manifest(tmp_path) == {}

    def test_v1_manifest_defaults_to_level(self, tmp_path):
        # The Oct 4 models' manifest: no trajectory_target -> level, as main() reads it.
        (tmp_path / "manifest.json").write_text(json.dumps({"trained_through": "2026-10-04", "recipe": "A"}))
        m = _read_manifest(tmp_path)
        assert m.get("trajectory_target", "level") == "level"
        assert str(m.get("trained_through", "unknown")) == "2026-10-04"


# ── Trajectory prediction from the booster's own feature list (Session 4) ───

class _FakeTrajBooster:
    """Stands in for a trajectory lgb.Booster: fixed output, records its X."""

    def __init__(self, feature_name_list, output):
        self._names = list(feature_name_list)
        self.output = output
        self.last_X = None

    def feature_name(self):
        return self._names

    def predict(self, X):
        assert list(X.columns) == self._names  # LightGBM requires the exact columns
        self.last_X = X
        return [self.output]


def _feat_row(wait=30.0, **overrides):
    row = {c: 1.0 for c in TRAJECTORY_FEATURE_COLS}
    row.update({"wait_minutes": wait, "ride_id_cat": "r1", "status_cat": "OPERATING",
                "is_holiday": False, "is_holiday_weekend": False})
    row.update(overrides)
    return row


A_COLS = [c for c in TRAJECTORY_FEATURE_COLS if c != "minutes_until_close"]  # Recipe A's 21
B_COLS = [c for c in TRAJECTORY_FEATURE_COLS if c != "week_of_year"]       # Recipe B's 21 (arm B3: no week_of_year, + minutes_until_close)


class TestPredictTrajectory:
    CATS = (["r1", "r2"], ["CLOSED", "DOWN", "OPERATING"])

    def _run(self, models, target="level", row=None):
        return _predict_trajectory(row or _feat_row(), models, *self.CATS, target)

    def test_delta_adds_current_wait(self):
        preds = self._run({60: _FakeTrajBooster(B_COLS, 7.0)}, "delta")
        assert preds[60] == 37.0

    def test_delta_clipped_at_zero(self):
        preds = self._run({60: _FakeTrajBooster(B_COLS, -40.0)}, "delta")
        assert preds[60] == 0.0

    def test_level_is_model_output(self):
        preds = self._run({60: _FakeTrajBooster(A_COLS, 42.0)}, "level")
        assert preds[60] == 42.0

    def test_default_target_is_level(self):
        preds = _predict_trajectory(_feat_row(), {60: _FakeTrajBooster(A_COLS, 42.0)}, *self.CATS)
        assert preds[60] == 42.0

    def test_t10_is_current_wait(self):
        preds = self._run({10: _FakeTrajBooster(B_COLS, 99.0), 60: _FakeTrajBooster(B_COLS, 1.0)}, "delta")
        assert preds[10] == 30.0 and preds[60] == 31.0

    def test_model_without_week_of_year_runs(self):
        booster = _FakeTrajBooster(B_COLS, 5.0)
        self._run({60: booster}, "delta")
        assert "week_of_year" not in booster.last_X.columns
        assert isinstance(booster.last_X["ride_id_cat"].dtype, pd.CategoricalDtype)
        assert list(booster.last_X["status_cat"].cat.categories) == self.CATS[1]

    def test_old_and_new_models_side_by_side(self):
        old, new = _FakeTrajBooster(A_COLS, 40.0), _FakeTrajBooster(B_COLS, 5.0)
        preds = self._run({30: old, 60: new}, "level")
        assert "week_of_year" in old.last_X.columns and "week_of_year" not in new.last_X.columns
        assert "minutes_until_close" not in old.last_X.columns and "minutes_until_close" in new.last_X.columns
        assert preds[30] == 40.0 and preds[60] == 5.0

    def test_unknown_column_gets_nan(self):
        booster = _FakeTrajBooster(B_COLS + ["some_future_feature"], 5.0)
        self._run({60: booster}, "delta")
        assert booster.last_X["some_future_feature"].dtype == float
        assert booster.last_X["some_future_feature"].isna().all()

    def test_unknown_close_reaches_model_as_nan(self):
        booster = _FakeTrajBooster(B_COLS, 5.0)
        self._run({60: booster}, "delta", row=_feat_row(minutes_until_close=None))
        assert booster.last_X["minutes_until_close"].dtype == float
        assert booster.last_X["minutes_until_close"].isna().all()

    def test_none_value_reaches_model_as_float_nan(self):
        # crowd_level_ratio is None before 10am; an object column makes LightGBM raise.
        booster = _FakeTrajBooster(B_COLS, 5.0)
        self._run({60: booster}, "delta", row=_feat_row(crowd_level_ratio=None))
        assert booster.last_X["crowd_level_ratio"].dtype == float
        assert booster.last_X["crowd_level_ratio"].isna().all()

    def test_real_booster_with_none_crowd_ratio(self, tmp_path):
        import lightgbm as lgb
        import numpy as np

        rng = np.random.default_rng(0)
        n = 300
        frame = pd.DataFrame({c: rng.random(n) for c in B_COLS if c not in ("ride_id_cat", "status_cat")})
        frame["ride_id_cat"] = pd.Categorical(rng.choice(self.CATS[0], n), categories=self.CATS[0])
        frame["status_cat"] = pd.Categorical(["OPERATING"] * n, categories=self.CATS[1])
        frame = frame[B_COLS]
        lgb.LGBMRegressor(n_estimators=3, verbose=-1).fit(frame, rng.random(n)).booster_.save_model(
            str(tmp_path / "t.txt"))
        booster = lgb.Booster(model_file=str(tmp_path / "t.txt"))
        preds = self._run({60: booster}, "delta", row=_feat_row(crowd_level_ratio=None))
        assert preds[60] >= 0.0


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


# ── Classifiers and the probability-derived trend word (Session 5) ─────────

# Shared with ml/tests/test_recipes.py (parity with ml.recipes.derive_trend).
TREND_THRESHOLDS = {
    "<=10":  {"call": {"rise": 0.60, "fall": 0.50}, "high": {"rise": 0.80, "fall": None}},
    "15-25": {"call": {"rise": 0.45, "fall": 0.40}, "high": {"rise": 0.70, "fall": 0.75}},
    "30-60": {"call": {"rise": 0.40, "fall": 0.45}, "high": {"rise": 0.65, "fall": 0.70}},
    ">60":   {"call": {"rise": None, "fall": 0.50}, "high": {"rise": None, "fall": 0.80}},
}

# (current, lag1, p_rise_30, p_fall_30) -> (trend, confidence)
TREND_GRID = [
    # <=10 band
    ((5.0, 5.0, 0.60, 0.10), ("rising", "medium")),       # exactly tau_call
    ((5.0, 5.0, 0.59, 0.10), ("stable", "low")),          # just under; 0.59 >= 0.30
    ((10.0, 5.0, 0.85, 0.05), ("trough", "high")),        # +5 since lag -> trough
    ((5.0, 10.0, 0.05, 0.90), ("peak", "medium")),        # high fall tau is None -> never high
    ((5.0, 5.0, 0.10, 0.12), ("stable", "high")),         # both < 0.15
    ((5.0, 5.0, 0.20, 0.10), ("stable", "medium")),       # both < 0.30
    # 15-25 band
    ((20.0, 20.0, 0.45, 0.10), ("rising", "medium")),
    ((20.0, 20.0, 0.44, 0.10), ("stable", "low")),
    ((25.0, 25.0, 0.10, 0.75), ("falling", "high")),
    ((20.0, 20.0, 0.50, 0.50), ("stable", "low")),        # tie -> stable
    ((20.0, 20.0, 0.50, 0.55), ("falling", "medium")),    # both called, fall bigger
    ((20.0, 15.0, 0.70, 0.10), ("trough", "high")),
    # 30-60 band
    ((30.0, 30.0, 0.40, 0.39), ("rising", "medium")),
    ((60.0, 60.0, 0.10, 0.45), ("falling", "medium")),
    ((45.0, 55.0, 0.10, 0.70), ("peak", "high")),
    ((45.0, 41.0, 0.70, 0.10), ("rising", "high")),       # +4 since lag -> not a trough
    ((45.0, 45.0, 0.29, 0.14), ("stable", "medium")),
    # >60 band
    ((65.0, 65.0, 0.99, 0.10), ("stable", "low")),        # rise tau None never fires
    ((90.0, 90.0, 0.05, 0.80), ("falling", "high")),
    ((90.0, 90.0, 0.05, 0.06), ("stable", "high")),
]


class TestTrendFromProbs:
    def test_grid(self):
        for args, expected in TREND_GRID:
            assert _derive_trend_from_probs(*args, TREND_THRESHOLDS) == expected, args

    def test_missing_inputs_are_none(self):
        assert _derive_trend_from_probs(20.0, 20.0, 0.9, 0.1, None) is None
        assert _derive_trend_from_probs(20.0, 20.0, None, 0.1, TREND_THRESHOLDS) is None
        assert _derive_trend_from_probs(20.0, 20.0, 0.9, float("nan"), TREND_THRESHOLDS) is None
        assert _derive_trend_from_probs(20.0, 20.0, 0.9, 0.1, {"<=10": TREND_THRESHOLDS["<=10"]}) is None

    def test_derive_trend_uses_classifier_when_given(self):
        preds = {h: 20.0 for h in HORIZONS}  # flat curve: regression says stable / low
        trend, delta30, conf, source = _derive_trend(
            20.0, 20.0, preds, {"p_rise_30": 0.9, "p_fall_30": 0.1}, TREND_THRESHOLDS)
        assert (trend, delta30, conf, source) == ("rising", 0.0, "high", "classifier")

    def test_falls_back_to_regression(self):
        preds = {h: 40.0 for h in HORIZONS}
        today = ("rising", 10.0, "high", "regression")
        assert _derive_trend(30.0, 30.0, preds) == today
        assert _derive_trend(30.0, 30.0, preds, None, TREND_THRESHOLDS) == today
        assert _derive_trend(30.0, 30.0, preds, {}, TREND_THRESHOLDS) == today
        assert _derive_trend(30.0, 30.0, preds, {"p_rise_30": 0.1, "p_fall_30": 0.9}, None) == today
        # Only the 60-minute classifiers present -> no T+30 probabilities -> regression.
        assert _derive_trend(30.0, 30.0, preds, {"p_rise_60": 0.1}, TREND_THRESHOLDS) == today


def _tiny_classifier(tmp_path, name="clf.txt"):
    import lightgbm as lgb
    import numpy as np

    rng = np.random.default_rng(0)
    n = 300
    cats = (["r1", "r2"], ["CLOSED", "DOWN", "OPERATING"])
    frame = pd.DataFrame({c: rng.random(n) for c in B_COLS if c not in ("ride_id_cat", "status_cat")})
    frame["ride_id_cat"] = pd.Categorical(rng.choice(cats[0], n), categories=cats[0])
    frame["status_cat"] = pd.Categorical(["OPERATING"] * n, categories=cats[1])
    frame = frame[B_COLS]
    y = (frame["wait_minutes"] > 0.5).astype(int)
    lgb.LGBMClassifier(n_estimators=3, verbose=-1).fit(frame, y).booster_.save_model(str(tmp_path / name))
    return lgb.Booster(model_file=str(tmp_path / name)), cats


class TestPredictClassifiers:
    def test_real_booster_with_none_feature(self, tmp_path):
        booster, cats = _tiny_classifier(tmp_path)
        probs = _predict_classifiers(
            _feat_row(crowd_level_ratio=None, minutes_until_close=None),
            {"p_rise_30": booster, "p_fall_30": booster}, *cats)
        assert set(probs) == {"p_rise_30", "p_fall_30"}
        assert all(0.0 <= v <= 1.0 for v in probs.values())
        assert probs["p_rise_30"] == round(probs["p_rise_30"], 3)

    def test_columns_follow_feature_name(self):
        booster = _FakeTrajBooster(B_COLS, 0.4567)
        probs = _predict_classifiers(_feat_row(crowd_level_ratio=None), {"p_fall_60": booster},
                                     ["r1", "r2"], ["CLOSED", "DOWN", "OPERATING"])
        assert probs == {"p_fall_60": 0.457}
        assert booster.last_X["crowd_level_ratio"].dtype == float
        assert isinstance(booster.last_X["ride_id_cat"].dtype, pd.CategoricalDtype)

    def test_no_classifiers_is_empty(self):
        assert _predict_classifiers(_feat_row(), {}, ["r1"], ["OPERATING"]) == {}


V3_MANIFEST = {
    "trained_through": "2026-10-21", "recipe": "B", "trajectory_target": "delta",
    "classifiers": {
        "p_fall_30": {"file": "clf_fall_30.txt", "horizon": 30, "direction": "fall", "label": ["flat", 5]},
        "p_fall_60": {"file": "clf_fall_60.txt", "horizon": 60, "direction": "fall", "label": ["flat", 5]},
        "p_rise_30": {"file": "clf_rise_30.txt", "horizon": 30, "direction": "rise", "label": ["flat", 5]},
        "p_rise_60": {"file": "clf_rise_60.txt", "horizon": 60, "direction": "rise", "label": ["flat", 5]},
    },
    "trend_thresholds": TREND_THRESHOLDS,
}
FIXED_FILES = [f"trajectory_t{h}.txt" for h in HORIZONS] + [
    "day_profile.txt", "feature_categories.json", "ride_regime_thresholds.json", "crowd_level_baselines.json"]


class TestModelFiles:
    def test_v3_manifest_adds_classifier_files(self):
        assert _model_files(V3_MANIFEST) == FIXED_FILES + [
            "clf_fall_30.txt", "clf_fall_60.txt", "clf_rise_30.txt", "clf_rise_60.txt"]

    def test_old_manifest_has_no_classifiers_and_no_reversion(self):
        files = _model_files({"trained_through": "2026-10-18", "recipe": "B", "reversion_exported": True})
        assert files == FIXED_FILES
        assert "reversion_model.txt" not in files and "ride_percentile_buckets.json" not in files
        assert _model_files({}) == FIXED_FILES


class TestLoadModels:
    def _models_dir(self, tmp_path, classifier_files=()):
        import shutil

        booster, cats = _tiny_classifier(tmp_path, "src.txt")
        d = tmp_path / "models"
        d.mkdir()
        for name in [f"trajectory_t{h}.txt" for h in HORIZONS] + ["day_profile.txt", *classifier_files]:
            shutil.copy(tmp_path / "src.txt", d / name)
        (d / "feature_categories.json").write_text(json.dumps(
            {"ride_id_categories": cats[0], "status_categories": cats[1]}))
        (d / "ride_regime_thresholds.json").write_text("{}")
        (d / "crowd_level_baselines.json").write_text("{}")
        return d

    def test_without_classifier_files(self, tmp_path):
        d = self._models_dir(tmp_path)
        (d / "manifest.json").write_text(json.dumps({"trained_through": "2026-10-18", "recipe": "B"}))
        traj, _, ride_cats, _, classifiers, _, _ = _load_models(d)
        assert classifiers == {} and len(traj) == len(HORIZONS) and ride_cats == ["r1", "r2"]

    def test_no_manifest_at_all(self, tmp_path):
        d = self._models_dir(tmp_path)
        assert _load_models(d)[4] == {}

    def test_v3_manifest_loads_classifiers(self, tmp_path):
        files = [spec["file"] for spec in V3_MANIFEST["classifiers"].values()]
        d = self._models_dir(tmp_path, files)
        classifiers = _load_models(d, V3_MANIFEST)[4]
        assert sorted(classifiers) == ["p_fall_30", "p_fall_60", "p_rise_30", "p_rise_60"]

    def test_listed_but_missing_file_is_skipped(self, tmp_path):
        d = self._models_dir(tmp_path, ["clf_rise_30.txt"])
        assert list(_load_models(d, V3_MANIFEST)[4]) == ["p_rise_30"]


class TestCurveConfidence:
    """_curve_confidence is the pre-Session-5 confidence rule, now its own field."""
    LATER = [40, 50, 60, 90, 120, 150, 180, 210, 240]

    def _preds(self, n_agree, t30=40.0, agree=40.0, disagree=20.0):
        preds = {10: 30.0, 20: 30.0, 30: t30}
        preds.update({h: (agree if i < n_agree else disagree) for i, h in enumerate(self.LATER)})
        return preds

    def test_matches_pre_session5_fixtures(self):
        # Same fixtures as TestDeriveTrendConfidence: 6 of 9 medium, 7 high, 4 low.
        assert _curve_confidence(30.0, self._preds(6)) == "medium"
        assert _curve_confidence(30.0, self._preds(7)) == "high"
        assert _curve_confidence(30.0, self._preds(4)) == "low"
        assert _curve_confidence(30.0, {h: 40.0 for h in HORIZONS}) == "high"

    def test_flat_t30_is_low(self):
        assert _curve_confidence(30.0, {h: 31.5 for h in HORIZONS}) == "low"

    def test_regression_path_equals_curve_confidence(self):
        for n in range(10):
            preds = self._preds(n)
            assert _derive_trend(30.0, 30.0, preds)[2] == _curve_confidence(30.0, preds)

    def test_classifier_path_keeps_both_separate(self):
        flat = {h: 20.0 for h in HORIZONS}
        trend, _, conf, source = _derive_trend(20.0, 20.0, flat, {"p_rise_30": 0.9, "p_fall_30": 0.1},
                                               TREND_THRESHOLDS)
        assert (trend, conf, source) == ("rising", "high", "classifier")
        assert _curve_confidence(20.0, flat) == "low"  # the engine still ignores a flat curve
