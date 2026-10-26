import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from ride_features import (
    HEADLINERS_FILE,
    POSTING_TIERS_FILE,
    export_sidecars,
    fill_missing_lags,
    headliners,
    last_updated_age_frame,
    last_updated_age_min,
    ll_fields,
    load_sidecars,
    operating_counts,
    operating_counts_frame,
    posting_tiers,
)

# Real `raw` blobs from df_features_cache.pkl (themeparks entity as collect.js stores it).
RAW_LL_AVAILABLE = {  # Star Tours, polled 2026-05-02 16:33:56.348 UTC
    "queue": {"STANDBY": {"waitTime": 10},
              "RETURN_TIME": {"state": "AVAILABLE", "returnStart": "2026-05-02T09:30:00-07:00", "returnEnd": None}},
    "name": "Star Tours - The Adventures Continue", "entityType": "ATTRACTION",
    "lastUpdated": "2026-05-02T16:29:29Z", "externalId": "353439;entityType=Attraction",
    "parkId": "7340550b-c14d-4def-80bb-acdb51d49a66", "status": "OPERATING",
    "id": "cc718d11-fa15-44ee-87d0-ded989ad61bc",
    "operatingHours": [{"startTime": "2026-05-02T08:00:00-07:00", "type": "Operating",
                        "endTime": "2026-05-02T23:00:00-07:00"}],
}
POLL_LL_AVAILABLE = pd.Timestamp("2026-05-02 16:33:56.348", tz="UTC")
RAW_LL_FINISHED = {  # Star Tours, polled 2026-05-03 04:07:22.308 UTC
    "queue": {"STANDBY": {"waitTime": 20},
              "RETURN_TIME": {"state": "FINISHED", "returnStart": None, "returnEnd": None}},
    "name": "Star Tours - The Adventures Continue", "entityType": "ATTRACTION",
    "lastUpdated": "2026-05-03T03:54:26Z", "externalId": "353439;entityType=Attraction",
    "parkId": "7340550b-c14d-4def-80bb-acdb51d49a66", "status": "OPERATING",
    "id": "cc718d11-fa15-44ee-87d0-ded989ad61bc",
}
POLL_LL_FINISHED = pd.Timestamp("2026-05-03 04:07:22.308", tz="UTC")
RAW_STANDBY_ONLY = {  # Sailing Ship Columbia, polled 2026-05-21 22:20:18.634 UTC
    "queue": {"STANDBY": {"waitTime": 10}},
    "name": "Sailing Ship Columbia", "lastUpdated": "2026-05-21T18:29:00Z", "entityType": "ATTRACTION",
    "externalId": "353425;entityType=Attraction", "parkId": "7340550b-c14d-4def-80bb-acdb51d49a66",
    "status": "OPERATING", "id": "c9e39189-7e99-4e0a-97e0-4a0d5654d257",
}
POLL_STANDBY_ONLY = pd.Timestamp("2026-05-21 22:20:18.634", tz="UTC")


class TestLightningLane:
    def test_available_offset(self):
        offset, state = ll_fields(RAW_LL_AVAILABLE["queue"], POLL_LL_AVAILABLE)
        # 09:30 PDT = 16:30 UTC, 3.9 minutes before the poll.
        assert state == "AVAILABLE"
        assert abs(offset - (-(3 * 60 + 56.348) / 60)) < 1e-9

    def test_finished(self):
        assert ll_fields(RAW_LL_FINISHED["queue"], POLL_LL_FINISHED) == (None, "FINISHED")

    def test_standby_only_is_none(self):
        assert ll_fields(RAW_STANDBY_ONLY["queue"], POLL_STANDBY_ONLY) == (None, "NONE")

    def test_missing_queue(self):
        assert ll_fields(None, POLL_STANDBY_ONLY) == (None, "NONE")
        assert ll_fields({}, POLL_STANDBY_ONLY) == (None, "NONE")

    def test_paid_return_time_counts(self):
        q = {"STANDBY": {"waitTime": 60},
             "PAID_RETURN_TIME": {"state": "AVAILABLE", "returnStart": "2026-05-02T11:00:00-07:00"}}
        offset, state = ll_fields(q, pd.Timestamp("2026-05-02 17:00", tz="UTC"))
        assert (offset, state) == (60.0, "AVAILABLE")

    def test_return_time_wins_over_paid(self):
        q = {"RETURN_TIME": {"state": "FINISHED"},
             "PAID_RETURN_TIME": {"state": "AVAILABLE", "returnStart": "2026-05-02T11:00:00-07:00"}}
        assert ll_fields(q, pd.Timestamp("2026-05-02 17:00", tz="UTC")) == (None, "FINISHED")

    def test_clipped(self):
        late = {"RETURN_TIME": {"state": "AVAILABLE", "returnStart": "2026-05-03T09:00:00-07:00"}}
        early = {"RETURN_TIME": {"state": "AVAILABLE", "returnStart": "2026-05-02T06:00:00-07:00"}}
        poll = datetime(2026, 5, 2, 17, 0, tzinfo=timezone.utc)
        assert ll_fields(late, poll)[0] == 600.0
        assert ll_fields(early, poll)[0] == -60.0

    def test_available_without_start_and_unknown_state(self):
        poll = POLL_LL_AVAILABLE
        assert ll_fields({"RETURN_TIME": {"state": "AVAILABLE", "returnStart": None}}, poll) == (None, "AVAILABLE")
        assert ll_fields({"RETURN_TIME": {"state": "TEMPORARILY_FULL"}}, poll) == (None, "NONE")


class TestLastUpdatedAge:
    def test_real_blobs(self):
        assert abs(last_updated_age_min(RAW_LL_AVAILABLE["lastUpdated"], POLL_LL_AVAILABLE)
                   - (4 * 60 + 27.348) / 60) < 1e-9
        assert last_updated_age_min(RAW_STANDBY_ONLY["lastUpdated"], POLL_STANDBY_ONLY) > 230

    def test_clip_and_missing(self):
        poll = pd.Timestamp("2026-05-02 17:00", tz="UTC")
        assert last_updated_age_min("2026-05-01T00:00:00Z", poll) == 360.0
        assert last_updated_age_min("2026-05-02T17:01:00Z", poll) == 0.0  # clock skew
        assert last_updated_age_min(None, poll) is None
        assert last_updated_age_min("not a date", poll) is None
        assert last_updated_age_min("2026-05-02T16:00:00Z", None) is None

    def test_frame_matches_scalar(self):
        lus = pd.Series([RAW_LL_AVAILABLE["lastUpdated"], RAW_STANDBY_ONLY["lastUpdated"], None, "2026-05-01T00:00:00Z"])
        polls = pd.Series([POLL_LL_AVAILABLE, POLL_STANDBY_ONLY, POLL_STANDBY_ONLY, POLL_LL_AVAILABLE])
        frame = last_updated_age_frame(lus, polls)
        for got, lu, poll in zip(frame, lus, polls):
            want = last_updated_age_min(lu, poll)
            assert (np.isnan(got) and want is None) or abs(got - want) < 1e-9


class TestPostingTiers:
    def test_median_threshold(self):
        ages = pd.DataFrame({"ride_id": ["a"] * 3 + ["b"] * 3 + ["c"],
                             "age": [1.0, 2.0, 300.0, 4.0, 6.0, 9.0, 5.0]})
        assert posting_tiers(ages) == {"a": "automated", "b": "hand", "c": "automated"}

    def test_nan_ages_ignored(self):
        ages = pd.DataFrame({"ride_id": ["a", "a", "b"], "age": [np.nan, 1.0, np.nan]})
        assert posting_tiers(ages) == {"a": "automated"}


def _poll():
    return pd.DataFrame({
        "ride_id": ["h1", "h2", "x", "h3", "y"],
        "park_id": ["dl", "dl", "dl", "dca", "dca"],
        "status": ["OPERATING", "DOWN", "OPERATING", "REFURBISHMENT", "OPERATING"],
        "timestamp_utc": pd.Timestamp("2026-10-01 20:00", tz="UTC"),
    })


class TestOperatingCounts:
    def test_counts_per_park(self):
        out = operating_counts(_poll(), ["h1", "h2", "h3", "absent"])
        assert out == {"dl": {"n_operating_rides_park": 2, "n_headliners_down": 1},
                       "dca": {"n_operating_rides_park": 1, "n_headliners_down": 1}}

    def test_no_headliners(self):
        out = operating_counts(_poll(), [])
        assert out["dl"]["n_headliners_down"] == 0 and out["dl"]["n_operating_rides_park"] == 2

    def test_frame_matches_per_poll(self):
        p1 = _poll()
        p2 = _poll().assign(timestamp_utc=pd.Timestamp("2026-10-01 20:10", tz="UTC"),
                            status=["OPERATING"] * 5)
        frame = pd.concat([p1, p2], ignore_index=True)
        counts = operating_counts_frame(frame, ["h1", "h2", "h3"])
        for ts, poll in frame.groupby("timestamp_utc"):
            want = operating_counts(poll, ["h1", "h2", "h3"])
            for i in poll.index:
                got = counts.loc[i]
                assert got.to_dict() == want[frame.loc[i, "park_id"]]

    def test_headliners_by_median_operating_wait(self):
        df = pd.DataFrame({"ride_id": ["a"] * 3 + ["b"] * 3,
                           "status": ["OPERATING", "OPERATING", "DOWN", "OPERATING", "OPERATING", "OPERATING"],
                           "wait_minutes": [30.0, 40.0, np.nan, 10.0, 25.0, 60.0]})
        assert headliners(df) == ["a"]
        assert headliners(df, min_median=20) == ["a", "b"]


class TestFillMissingLags:
    def _frame(self):
        return pd.DataFrame({
            "status": ["OPERATING", "OPERATING", "DOWN", "OPERATING", "OPERATING"],
            "wait_minutes": [40.0, 25.0, np.nan, np.nan, 30.0],
            "wait_lag_1": [35.0, np.nan, 20.0, np.nan, 25.0],
            "wait_lag_2": [30.0, np.nan, np.nan, np.nan, np.nan],
            "wait_lag_3": [25.0, np.nan, np.nan, np.nan, np.nan],
            "wait_delta_1": [5.0, np.nan, np.nan, np.nan, 5.0],
            "training_valid_t60": [True, False, False, False, False],
        })

    def test_fills_operating_rows_with_a_wait(self):
        df = self._frame()
        out = fill_missing_lags(df)
        assert out["lags_missing"].tolist() == [0, 1, 0, 0, 1]
        # reopen: every lag null -> the current wait, delta 0
        assert out.loc[1, ["wait_lag_1", "wait_lag_2", "wait_lag_3", "wait_delta_1"]].tolist() == [25.0, 25.0, 25.0, 0.0]
        # second poll after reopen: lag 1 is real, the rest are filled
        assert out.loc[4, ["wait_lag_1", "wait_lag_2", "wait_lag_3", "wait_delta_1"]].tolist() == [25.0, 30.0, 30.0, 5.0]

    def test_leaves_other_rows_and_the_input_alone(self):
        df = self._frame()
        before = df.copy()
        out = fill_missing_lags(df)
        pd.testing.assert_frame_equal(df, before)
        pd.testing.assert_series_equal(out.loc[0, df.columns], df.loc[0])  # complete row untouched
        assert np.isnan(out.loc[2, "wait_lag_2"]) and np.isnan(out.loc[3, "wait_lag_1"])  # DOWN / no wait
        assert out["training_valid_t60"].tolist() == df["training_valid_t60"].tolist()


class TestSidecars:
    def _df(self):
        return pd.DataFrame({
            "ride_id": ["a", "a", "b", "b"],
            "status": ["OPERATING"] * 4,
            "wait_minutes": [45.0, 35.0, 10.0, 5.0],
            "timestamp_utc": pd.Timestamp("2026-10-01 20:00", tz="UTC"),
            "raw": [{"lastUpdated": "2026-10-01T19:58:00Z"}, {"lastUpdated": "2026-10-01T19:59:00Z"},
                    {"lastUpdated": "2026-10-01T18:00:00Z"}, {}],
        })

    def test_export_and_load_round_trip(self, tmp_path):
        names = export_sidecars(self._df(), tmp_path)
        assert names == [HEADLINERS_FILE, POSTING_TIERS_FILE]
        assert json.loads((tmp_path / HEADLINERS_FILE).read_text()) == ["a"]
        assert json.loads((tmp_path / POSTING_TIERS_FILE).read_text()) == {"a": "automated", "b": "hand"}
        assert load_sidecars(tmp_path) == {"headliners": ["a"], "posting_tiers": {"a": "automated", "b": "hand"}}

    def test_missing_or_bad_files_read_empty(self, tmp_path):
        assert load_sidecars(tmp_path) == {"headliners": [], "posting_tiers": {}}
        (tmp_path / HEADLINERS_FILE).write_text("{not json")
        (tmp_path / POSTING_TIERS_FILE).write_text("[1, 2]")
        assert load_sidecars(tmp_path) == {"headliners": [], "posting_tiers": {}}
