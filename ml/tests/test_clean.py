"""ml.clean on a small synthetic raw frame: two parks, three dates."""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import pytest

from ml import clean

DL, DCA = "park-dl", "park-dca"
TRACKED, TREEHOUSE, UNKNOWN = "ride-tracked", "ride-treehouse", "ride-unknown"
VILLAINS = "ride-villains"

METADATA = {
    "dl_tracked": {"themeparks_id": TRACKED, "tracks_wait_time": True},
    "dl_treehouse": {"themeparks_id": TREEHOUSE, "tracks_wait_time": False},
    "dca_villains": {"themeparks_id": VILLAINS, "tracks_wait_time": True},
}

SCHEDULES = pd.DataFrame([
    # DL 2026-06-06: 8 AM to 12:00 AM (next day)
    {"date": "2026-06-06", "parkId": DL, "parkName": "Disneyland Park", "entries": [
        {"type": "INFO", "openingTime": "2026-06-06T07:00:00-07:00", "closingTime": "2026-06-06T08:00:00-07:00"},
        {"type": "OPERATING", "openingTime": "2026-06-06T08:00:00-07:00", "closingTime": "2026-06-07T00:00:00-07:00"},
    ]},
    # DCA 2026-09-15: public 8 AM to 6 PM, Oogie Boogie Bash 6 PM to 11 PM
    {"date": "2026-09-15", "parkId": DCA, "parkName": "Disney California Adventure Park", "entries": [
        {"type": "OPERATING", "openingTime": "2026-09-15T08:00:00-07:00", "closingTime": "2026-09-15T18:00:00-07:00"},
        {"type": "TICKETED_EVENT", "openingTime": "2026-09-15T18:00:00-07:00", "closingTime": "2026-09-15T23:00:00-07:00"},
    ]},
    # DCA 2026-09-16: early entry (ticketed before open), not after close
    {"date": "2026-09-16", "parkId": DCA, "parkName": "Disney California Adventure Park", "entries": [
        {"type": "TICKETED_EVENT", "openingTime": "2026-09-16T07:30:00-07:00", "closingTime": "2026-09-16T08:00:00-07:00"},
        {"type": "OPERATING", "openingTime": "2026-09-16T08:00:00-07:00", "closingTime": "2026-09-16T21:00:00-07:00"},
    ]},
    # 2026-07-01 has no schedule row for either park
])


def _row(park, ride_id, ride_name, local, status="OPERATING", wait=20.0):
    ts = pd.Timestamp(local, tz=clean.LA).tz_convert("UTC")
    park_name = "Disneyland Park" if park == DL else "Disney California Adventure Park"
    return dict(park_id=park, park_name=park_name, ride_id=ride_id, ride_name=ride_name,
                timestamp_utc=ts, status=status, wait_minutes=wait, wait_minutes_raw=wait)


@pytest.fixture
def raw() -> pd.DataFrame:
    rows = [
        # DL midnight-close day: nothing before midnight is dropped
        _row(DL, TRACKED, "Tracked Ride", "2026-06-06 22:00"),
        _row(DL, TRACKED, "Tracked Ride", "2026-06-06 23:50"),
        # DCA party night
        _row(DCA, TRACKED, "Tracked Ride", "2026-09-15 17:50"),
        _row(DCA, TRACKED, "Tracked Ride", "2026-09-15 18:00"),   # exactly at close: kept
        _row(DCA, TRACKED, "Tracked Ride", "2026-09-15 18:10"),   # dropped
        _row(DCA, TRACKED, "Tracked Ride", "2026-09-15 20:00"),   # dropped
        _row(DCA, VILLAINS, "Villains Grove at Oogie Boogie Bash", "2026-09-15 17:00"),
        _row(DCA, VILLAINS, "Villains Grove at Oogie Boogie Bash", "2026-09-16 12:00"),
        # DCA normal day
        _row(DCA, TRACKED, "Tracked Ride", "2026-09-16 20:50"),
        # unscheduled date: late rows kept
        _row(DL, TRACKED, "Tracked Ride", "2026-07-01 23:30"),
        # zeros
        _row(DL, TRACKED, "Tracked Ride", "2026-06-06 12:00", wait=0.0),            # -> NaN
        _row(DL, TRACKED, "Tracked Ride", "2026-06-06 12:10", status="CLOSED", wait=0.0),  # not OPERATING
        _row(DL, TREEHOUSE, "Adventureland Treehouse", "2026-06-06 12:00", wait=0.0),  # kept
        _row(DL, UNKNOWN, "Not In Metadata", "2026-06-06 12:00", wait=0.0),           # kept
    ]
    return pd.DataFrame(rows)


def test_public_hours_midnight_close_is_1440():
    hours = clean.public_hours(SCHEDULES).set_index(["park_id", "date_la"])
    dl = hours.loc[(DL, date(2026, 6, 6))]
    assert dl["open_minutes"] == 480
    assert dl["close_minutes"] == 1440
    assert not dl["has_ticketed_after_close"]


def test_public_hours_ticketed_after_close():
    hours = clean.public_hours(SCHEDULES).set_index(["park_id", "date_la"])
    assert hours.loc[(DCA, date(2026, 9, 15)), "close_minutes"] == 1080
    assert hours.loc[(DCA, date(2026, 9, 15)), "has_ticketed_after_close"]
    assert not hours.loc[(DCA, date(2026, 9, 16)), "has_ticketed_after_close"]  # early entry only
    assert list(clean.public_hours(SCHEDULES).columns) == clean.HOURS_COLS


def test_drop_after_public_close(raw):
    out, info = clean.drop_after_public_close(raw, clean.public_hours(SCHEDULES))
    local = out["timestamp_utc"].dt.tz_convert(clean.LA).dt.strftime("%Y-%m-%d %H:%M")
    kept = set(zip(out["park_id"], local))
    assert (DCA, "2026-09-15 17:50") in kept
    assert (DCA, "2026-09-15 18:00") in kept
    assert (DCA, "2026-09-15 18:10") not in kept
    assert (DCA, "2026-09-15 20:00") not in kept
    assert (DL, "2026-06-06 23:50") in kept
    assert (DL, "2026-07-01 23:30") in kept
    assert info["after_public_close"] == 2
    assert info["dates_affected"] == [("2026-09-15", "Disney California Adventure Park", 2)]


def test_drop_party_entities(raw):
    out, info = clean.drop_party_entities(raw)
    assert info["party_entities"] == 2
    assert not out["ride_name"].str.contains("Oogie").any()


def test_zero_to_missing(raw):
    out, info = clean.zero_to_missing(raw, METADATA)
    assert info["zero_to_missing"] == 1
    noon = out["timestamp_utc"].dt.tz_convert(clean.LA).dt.strftime("%H:%M") == "12:00"
    tracked = out[(out["ride_id"] == TRACKED) & noon].iloc[0]
    assert np.isnan(tracked["wait_minutes"]) and tracked["wait_minutes_raw"] == 0
    assert out.loc[out["ride_id"] == TREEHOUSE, "wait_minutes"].iloc[0] == 0
    assert out.loc[out["ride_id"] == UNKNOWN, "wait_minutes"].iloc[0] == 0
    assert (out.loc[out["status"] == "CLOSED", "wait_minutes"] == 0).all()
    assert (raw["wait_minutes"] == 0).sum() == 4  # input untouched


def test_clean_frame_summary_and_columns(raw, capsys):
    out, summary = clean.clean_frame(raw, SCHEDULES, METADATA)
    assert summary["after_public_close"] == 2
    assert summary["party_entities"] == 2
    assert summary["zero_to_missing"] == 1
    assert summary["rows_in"] == len(raw) == 14
    assert summary["rows_out"] == len(out) == 10
    assert summary["party_dates"] == [("2026-09-15", "Disney California Adventure Park")]
    assert list(out.columns) == list(raw.columns)
    assert len(capsys.readouterr().out.strip().splitlines()) == 4


def test_clean_frame_without_schedules_keeps_rows(raw):
    empty = SCHEDULES.iloc[0:0]
    out, summary = clean.clean_frame(raw, empty, METADATA)
    assert summary["after_public_close"] == 0
    assert summary["party_dates"] == []
    assert len(out) == len(raw) - 2
