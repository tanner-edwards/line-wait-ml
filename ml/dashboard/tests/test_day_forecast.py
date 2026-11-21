from datetime import timedelta

import pandas as pd
import pytest

from ml.dashboard import day_forecast as dfc
from ml.dashboard.tests.test_grading import CONFIG, DAY, DL, _at, _docs, _schedules
from ml.dashboard import grading


class TestHourly:
    def test_half_hour_slots_average_into_hours_inside_the_window(self):
        slots = [{"start_minutes": 420, "wait": 5}, {"start_minutes": 450, "wait": 5},   # 7am: before open
                 {"start_minutes": 480, "wait": 10}, {"start_minutes": 510, "wait": 20},  # 8am
                 {"start_minutes": 540, "wait": None}, {"start_minutes": 570, "wait": 30},  # 9am, one masked
                 {"start_minutes": 600, "wait": 40}]  # 10am: at/after close
        assert dfc.slots_to_hours(slots, 480, 600) == {8: 15, 9: 30}

    def test_close_on_the_half_hour_keeps_that_hour(self):
        slots = [{"start_minutes": 1320, "wait": 10}]  # 10pm, park closes 10:30pm
        assert dfc.slots_to_hours(slots, 480, 1350) == {22: 10}

    def test_disney_uses_the_earliest_snapshot(self):
        docs = [{"rideId": "a", "byHour": {"09": {"10": 99}, "08": {"10": 30, "11": 40}}},
                {"rideId": "b", "byHour": {}}]
        fc, snap = dfc.disney_hourly(docs)
        assert fc == {"a": {10: 30.0, 11: 40.0}}
        assert snap == {"a": "08"}

    def test_actual_is_hourly_mean_of_raw_operating_polls(self):
        df = pd.DataFrame({
            "ride_id": ["a"] * 4,
            "status": ["OPERATING", "OPERATING", "DOWN", "OPERATING"],
            "wait_minutes": [5.0, 30.0, None, 40.0],
            "wait_minutes_raw": [13.0, 30.0, None, 40.0],  # walk-on marker kept raw
            "timestamp_utc": pd.to_datetime([_at(10), _at(10, 30), _at(10, 40), _at(11)], utc=True),
        })
        assert dfc.actual_hourly(df) == {"a": {10: 21.5, 11: 40.0}}


class TestCompare:
    def test_scorecard_and_blocks(self):
        disney = {"a": {10: 30, 13: 50}, "b": {10: 10}}
        ours = {"a": {10: 22, 13: 40}, "b": {10: 12}}
        actual = {"a": {10: 20, 13: 50}, "b": {10: 10}}
        out = dfc.compare(disney, ours, actual, [], {})
        s = out["scorecard"]["all"]
        assert s["n"] == 3 and s["rides"] == 2
        assert s["mae_disney"] == pytest.approx(10 / 3, abs=0.05)  # 10, 0, 0
        assert s["mae_ours"] == pytest.approx(14 / 3, abs=0.05)    # 2, 10, 2
        assert s["ours_closer_pct"] == 33  # only a@10
        blocks = {b["block"]: b for b in out["scorecard"]["blocks"]}
        assert blocks["Open–11am"]["n"] == 2 and blocks["12–4pm"]["n"] == 1
        assert blocks["8pm–close"]["n"] == 0 and blocks["8pm–close"]["mae_ours"] is None

    def test_hours_missing_any_value_are_not_scored(self):
        out = dfc.compare({"a": {10: 30, 11: 30}}, {"a": {10: 20}}, {"a": {10: 25, 11: 25}}, [], {})
        assert out["scorecard"]["all"]["n"] == 1

    def test_bellwether_without_disney_is_charted_not_scored(self):
        out = dfc.compare({}, {"x": {9: 10, 10: 20}}, {"x": {8: 5, 9: 12, 10: 18}}, ["x"], {"x": "Overlay"})
        assert out["scorecard"]["all"]["n"] == 0
        r = out["rides"][0]
        assert r["has_disney"] is False and r["ride_name"] == "Overlay"
        assert [h["hour"] for h in r["hours"]] == [9, 10]  # clipped to our (operating-window) hours
        assert r["hours"][0] == {"hour": 9, "disney": None, "ours": 10.0, "actual": 12.0}


class TestGradeCard:
    def test_card_present_only_when_day_forecasts_given(self):
        plain = grading.grade(_docs(), _schedules(), [], [], {}, {}, {}, DAY, CONFIG)["parks"][DL]
        assert plain["disney_vs_ours"] is None
        fc = {"disney": {"a": {10: 30.0, 11: 60.0}}, "disney_snapshot": {"a": "08"},
              "ours": {"a": {10: 35.0, 11: 70.0}}, "model_version": "v1", "temp_high_f": 80.0,
              "weather_fallback": False}
        card = grading.grade(_docs(), _schedules(), [], [], {}, {}, {}, DAY, CONFIG, fc)["parks"][DL]["disney_vs_ours"]
        # ride a posts 20..75 in 5s from 10:00: hour 10 mean 32.5, hour 11 mean 62.5
        assert card["scorecard"]["all"]["n"] == 2
        assert card["scorecard"]["all"]["mae_disney"] == pytest.approx(2.5)
        assert card["scorecard"]["all"]["mae_ours"] == pytest.approx(5.0)
        assert card["rides"][0]["ride_id"] == "a" and card["disney_snapshot_hours"] == ["08"]

    def test_disney_rides_from_another_park_are_ignored(self):
        fc = {"disney": {"zzz": {10: 30.0}}, "disney_snapshot": {"zzz": "08"}, "ours": {},
              "model_version": "v1", "temp_high_f": 80.0, "weather_fallback": False}
        out = grading.grade(_docs(), _schedules(), [], [], {}, {}, {}, DAY, CONFIG, fc)["parks"][DL]
        assert out["disney_vs_ours"] is None
