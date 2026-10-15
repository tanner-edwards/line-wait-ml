"""Synthetic feature frame shaped like the notebook's df_sorted.

3 rides in each of 2 parks, 40 consecutive dates, polls every 10 min from
08:00 to 22:00 LA time. Waits are ride base + an hour curve + small noise,
rounded to 5, so models have something learnable. One ride closes for an hour
every day so NaN waits and invalid targets are exercised.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

HORIZONS = [10, 20, 30, 40, 50, 60, 90, 120, 150, 180, 210, 240]
START = date(2026, 8, 1)
N_DAYS = 40
HOLIDAY = date(2026, 9, 7)  # Labor Day

RIDES = [
    # ride_id, ride_name, park_name, base wait
    ("r1", "Ride One", "Park A", 45),
    ("r2", "Ride Two", "Park A", 20),
    ("r3", "Ride Three", "Park A", 10),
    ("r4", "Ride Four", "Park B", 60),
    ("r5", "Ride Five", "Park B", 30),
    ("r6", "Ride Six", "Park B", 15),
]
RIDE_CATS = [r[0] for r in RIDES]
STATUS_CATS = ["CLOSED", "DOWN", "OPERATING", "REFURBISHMENT"]


def build_frame() -> pd.DataFrame:
    rng = np.random.default_rng(7)
    dates = [START + timedelta(days=i) for i in range(N_DAYS)]
    minutes = np.arange(8 * 60, 22 * 60 + 1, 10)  # 85 polls per day

    grid = pd.MultiIndex.from_product(
        [range(len(RIDES)), range(N_DAYS), minutes], names=["ride_ix", "day_ix", "minute"]
    ).to_frame(index=False)
    ride = grid["ride_ix"].to_numpy()
    minute = grid["minute"].to_numpy()

    df = pd.DataFrame({
        "ride_id": np.array(RIDE_CATS)[ride],
        "ride_name": np.array([r[1] for r in RIDES])[ride],
        "park_name": np.array([r[2] for r in RIDES])[ride],
    })
    df["date_la"] = [dates[i] for i in grid["day_ix"]]
    local = pd.to_datetime(
        pd.Series([d.isoformat() for d in df["date_la"]]) + " 00:00"
    ) + pd.to_timedelta(minute, unit="min")
    df["timestamp_utc"] = local.dt.tz_localize("America/Los_Angeles").dt.tz_convert("UTC")
    df["hour_of_day"] = minute // 60
    py_dow = np.array([d.weekday() for d in df["date_la"]])
    df["day_of_week"] = (py_dow + 1) % 7  # JS: Sunday = 0
    df["month"] = [d.month for d in df["date_la"]]
    df["week_of_year"] = [d.isocalendar().week for d in df["date_la"]]
    df["is_holiday"] = df["date_la"] == HOLIDAY
    df["is_holiday_weekend"] = df["is_holiday"]
    days_to = np.array([(HOLIDAY - d).days for d in df["date_la"]])
    df["days_until_next_holiday"] = np.where(days_to >= 0, days_to, 300)
    df["days_since_last_holiday"] = np.where(days_to <= 0, -days_to, 60)

    base = np.array([r[3] for r in RIDES])[ride]
    curve = 15 * np.sin((minute - 8 * 60) / (14 * 60) * np.pi)
    weekend_bump = np.where(np.isin(df["day_of_week"], [0, 6]), 10, 0)
    wait = np.round((base + curve + weekend_bump + rng.normal(0, 3, len(df))) / 5) * 5
    wait = np.clip(wait, 5, None)
    closed = (ride == 2) & (minute >= 12 * 60) & (minute < 13 * 60)
    df["status"] = np.where(closed, "CLOSED", "OPERATING")
    df["wait_minutes"] = np.where(closed, np.nan, wait)

    g = df.groupby(["ride_id", "date_la"], sort=False)["wait_minutes"]
    for k in (1, 2, 3):
        df[f"wait_lag_{k}"] = g.shift(k)
    df["wait_delta_1"] = df["wait_minutes"] - df["wait_lag_1"]
    for h in HORIZONS:
        target = g.shift(-(h // 10))
        df[f"target_t{h}"] = target
        df[f"valid_t{h}"] = target.notna()
        df[f"training_valid_t{h}"] = target.notna() & df["wait_minutes"].notna()

    df["park_crowd_median"] = df.groupby(["park_name", "timestamp_utc"])["wait_minutes"].transform("median")
    df["minutes_since_last_status_change"] = (minute - 8 * 60).astype(float)
    df["closure_duration_minutes"] = 0.0
    df["minutes_at_current_level"] = 10.0
    df["wait_regime_danger_zone"] = 0
    df["crowd_level_ratio"] = 1.0 + 0.01 * (minute - 8 * 60) / 60
    df["temp_high_f"] = 80.0
    df["morning_crowd_index"] = 1.0 + 0.1 * (py_dow % 3)
    df["minutes_until_close"] = (22 * 60 - minute).astype(float)
    df["total_operating_hours"] = 14.0
    df["had_closure_today"] = False
    df["max_closure_duration_today_min"] = 0.0
    df["hours_since_reopen"] = 0.0
    df["closure_start_hour"] = -1.0
    return df


@pytest.fixture(scope="session")
def frame() -> pd.DataFrame:
    return build_frame()


@pytest.fixture
def cats() -> tuple[list, list]:
    return RIDE_CATS, STATUS_CATS
