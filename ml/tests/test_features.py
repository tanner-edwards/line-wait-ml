import json

import numpy as np
import pandas as pd
import pytest

from ml.features import F4_SUFFIX, NEW_COLUMNS, add_session6_features, coverage, fit_sidecars, ride_flags
from ml.splits import forward_split


@pytest.fixture(scope="module")
def raw_frame(frame):
    """The synthetic frame plus park_id and a themeparks-style raw blob: r1 posts
    automatically (lastUpdated 2 min old) and has a Lightning Lane, the rest are
    hand-posted 30 min old."""
    df = frame.copy()
    df["park_id"] = df["park_name"].map({"Park A": "pa", "Park B": "pb"})
    lags_ok = df[["wait_lag_1", "wait_lag_2", "wait_lag_3"]].notna().all(axis=1)
    for c in [c for c in df.columns if c.startswith("training_valid_t")]:
        df[c] = df[c] & lags_ok  # as the notebook builds it: no row with a null lag trains

    def blob(ride, ts):
        age = 2 if ride == "r1" else 30
        out = {"lastUpdated": (ts - pd.Timedelta(minutes=age)).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "queue": {"STANDBY": {"waitTime": 10}}}
        if ride == "r1":
            start = (ts + pd.Timedelta(minutes=45)).tz_convert("America/Los_Angeles").isoformat()
            out["queue"]["RETURN_TIME"] = {"state": "AVAILABLE", "returnStart": start, "returnEnd": None}
        return out

    df["raw"] = [blob(r, t) for r, t in zip(df["ride_id"], df["timestamp_utc"])]
    return df


@pytest.fixture(scope="module")
def metadata(tmp_path_factory):
    path = tmp_path_factory.mktemp("meta") / "ride_metadata.json"
    path.write_text(json.dumps({
        "x_one": {"name": "Ride One", "themeparks_id": "r1", "water_ride": True},
        "x_two": {"name": "Grizzly River Run", "themeparks_id": "r2", "water_ride": True},
        "x_four": {"name": "Ride Four", "themeparks_id": "r4", "water_ride": False},
    }))
    return path


@pytest.fixture(scope="module")
def featured(raw_frame, metadata):
    train, _ = forward_split(raw_frame, weeks=2)
    heads, tiers = fit_sidecars(raw_frame, train)
    return add_session6_features(raw_frame, heads, tiers, metadata_path=metadata), heads, tiers


class TestSidecarsFromTrainRows:
    def test_headliners_and_tiers(self, featured):
        _, heads, tiers = featured
        # median operating wait >= 30: the base-45/60 rides are in, the base-10/15 ones out
        assert {"r1", "r4"} <= set(heads) and not {"r3", "r6"} & set(heads)
        assert tiers["r1"] == "automated" and tiers["r2"] == "hand"


class TestAddSession6Features:
    def test_every_column_added_and_input_untouched(self, raw_frame, featured):
        out = featured[0]
        assert set(NEW_COLUMNS) <= set(out.columns)
        assert "n_operating_rides_park" not in raw_frame.columns
        assert len(out) == len(raw_frame)

    def test_operating_counts_per_poll_and_park(self, featured):
        out = featured[0]
        # Park A: r3 is CLOSED 12:00-13:00 and is not a headliner.
        noon = out[(out["park_id"] == "pa") & (out["hour_of_day"] == 12)]
        assert (noon["n_operating_rides_park"] == 2).all() and (noon["n_headliners_down"] == 0).all()
        assert (out.loc[out["park_id"] == "pb", "n_operating_rides_park"] == 3).all()

    def test_staleness_and_tier(self, featured):
        out = featured[0]
        r1 = out["ride_id"] == "r1"
        assert np.allclose(out.loc[r1, "last_updated_age_min"], 2.0)
        assert np.allclose(out.loc[~r1, "last_updated_age_min"], 30.0)
        assert out["posting_tier_cat"].dtype == "category"
        assert list(out["posting_tier_cat"].cat.categories) == ["automated", "hand"]

    def test_lightning_lane(self, featured):
        out = featured[0]
        r1 = out["ride_id"] == "r1"
        assert np.allclose(out.loc[r1, "ll_offset_min"], 45.0)
        assert out.loc[~r1, "ll_offset_min"].isna().all()
        assert set(out.loc[r1, "ll_state_cat"]) == {"AVAILABLE"} and set(out.loc[~r1, "ll_state_cat"]) == {"NONE"}

    def test_reopen_rows_filled_on_copies_and_widened_mask(self, featured):
        out = featured[0]
        reopen = out["lags_missing"] == 1
        assert reopen.any()
        # r3 after its noon closure, plus every ride's first polls of the day (lags reset per day)
        assert ((out["ride_id"] == "r3") & (out["hour_of_day"] == 13) & reopen).sum() == 3 * out["date_la"].nunique()
        assert out.loc[reopen, ["wait_lag_1", "wait_lag_2", "wait_lag_3"]].isna().any(axis=1).all()
        # originals untouched, copies filled with the current wait
        assert out.loc[reopen, "wait_lag_1"].isna().any()
        for c in ("wait_lag_1", "wait_lag_2", "wait_lag_3"):
            assert (out.loc[reopen, f"{c}{F4_SUFFIX}"] == out.loc[reopen, "wait_minutes"]).sum() > 0
            assert out.loc[reopen, f"{c}{F4_SUFFIX}"].notna().all()
        assert (out.loc[~reopen, "wait_lag_1_f"].fillna(-1) == out.loc[~reopen, "wait_lag_1"].fillna(-1)).all()
        for h in (30, 60):
            orig, wide = out[f"training_valid_t{h}"], out[f"training_valid_t{h}{F4_SUFFIX}"]
            assert (orig <= wide).all()
            extra = wide & ~orig
            assert extra.any() and (out.loc[extra, "lags_missing"] == 1).all()
            assert out.loc[extra, f"target_t{h}"].notna().all()

    def test_water_and_soak(self, featured):
        out = featured[0]
        assert set(out.loc[out["water_ride"] == 1, "ride_id"]) == {"r1", "r2"}
        assert set(out.loc[out["soak_ride"] == 1, "ride_id"]) == {"r2"}
        assert (out.loc[out["ride_id"] == "r2", "soak_ride_x_temp"] == 80.0).all()
        assert (out.loc[out["ride_id"] == "r4", "water_ride_x_temp"] == 0.0).all()

    def test_real_metadata_flags(self):
        water, soak = ride_flags()
        assert len(water) == 10 and len(soak) == 3 and soak <= water

    def test_coverage_table(self, featured):
        out = featured[0]
        table = coverage(out, out["training_valid_t60"])
        assert table.index.tolist() == NEW_COLUMNS
        assert table.loc["ll_offset_min", "non_null"] == pytest.approx(
            (out.loc[out["training_valid_t60"], "ride_id"] == "r1").mean())
