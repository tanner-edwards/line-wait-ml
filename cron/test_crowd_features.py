from datetime import date, datetime
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest

from crowd_features import (
    DCA_PARK_ID,
    DL_PARK_ID,
    crowd_expected_table,
    crowd_key,
    crowd_level_ratio_frame,
    crowd_level_ratio_live,
    day_type,
    headliner_ride_ids,
    morning_crowd_index_frame,
    morning_crowd_index_live,
    morning_expected_table,
    morning_key,
    park_label,
    regime_for,
    regime_thresholds,
)

LA = ZoneInfo("America/Los_Angeles")
SAT, HOLIDAY, WED = date(2026, 9, 5), date(2026, 9, 7), date(2026, 9, 9)  # Labor Day = 9/7
DATES = [SAT, HOLIDAY, WED]
N_RIDES = 9  # per park; the < 8 rides guard needs at least 8
OVERLAY_ID = "dl0"


def _rides():
    rides = []
    for park, prefix, base in ((DL_PARK_ID, "dl", 15), (DCA_PARK_ID, "dca", 10)):
        for i in range(N_RIDES):
            rides.append((f"{prefix}{i}", f"{prefix.upper()} Ride {i}", park, base + 5 * i))
    return rides


def build_frame() -> pd.DataFrame:
    """Two parks x 9 rides, 3 dates, 10-min polls 08:00-22:00 local. DCA opens
    at 08:30 (CLOSED before). dl0 is an overlay pair: 'Haunted Mansion' on the
    first two dates, 'Haunted Mansion Holiday' (busier) on the last."""
    rng = np.random.default_rng(3)
    rows = []
    for d in DATES:
        day_bump = {SAT: 10, HOLIDAY: 20, WED: 0}[d]
        for minute in range(8 * 60, 22 * 60 + 1, 10):
            ts = pd.Timestamp(datetime(d.year, d.month, d.day, minute // 60, minute % 60, tzinfo=LA)).tz_convert("UTC")
            for ride_id, name, park, base in _rides():
                if ride_id == OVERLAY_ID:
                    name = "Haunted Mansion Holiday" if d == WED else "Haunted Mansion"
                    base = 60 if d == WED else 20
                closed = park == DCA_PARK_ID and minute < 8 * 60 + 30
                evening = 15 if (park == DCA_PARK_ID and minute >= 18 * 60) else 0
                curve = 10 * np.sin((minute - 480) / 840 * np.pi)
                wait = max(5.0, round((base + day_bump + evening + curve + rng.normal(0, 4)) / 5) * 5)
                rows.append({
                    "ride_id": ride_id, "ride_name": name, "park_id": park,
                    "park_name": "Disneyland Park" if park == DL_PARK_ID else "Disney California Adventure Park",
                    "timestamp_utc": ts, "date_la": d, "hour_of_day": minute // 60,
                    "day_of_week": (d.weekday() + 1) % 7, "month": d.month, "is_holiday": d == HOLIDAY,
                    "status": "CLOSED" if closed else "OPERATING",
                    "wait_minutes": np.nan if closed else float(wait),
                })
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def frame():
    return build_frame()


@pytest.fixture(scope="module")
def all_rows(frame):
    return pd.Series(True, index=frame.index)


def _hol(d: date) -> dict:
    return {"is_holiday": d == HOLIDAY}


def _at(d: date, hour: int, minute: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=LA)


# ── Oracles: the v1 notebook cells, copied ───────────────────────────────────

def notebook_crowd_ratio(df_sorted: pd.DataFrame) -> pd.Series:
    _op = df_sorted[(df_sorted['status'] == 'OPERATING') & df_sorted['wait_minutes'].notna()].copy()
    _op['_cl_day_type'] = _op['day_of_week'].apply(lambda d: 'weekend' if d in (0, 6) else 'weekday')
    _op.loc[_op['is_holiday'], '_cl_day_type'] = 'holiday'
    _poll_sums = (
        _op.groupby('timestamp_utc')
        .agg(park_sum=('wait_minutes', 'sum'), n_rides=('ride_id', 'nunique'),
             hour_of_day=('hour_of_day', 'first'), day_type=('_cl_day_type', 'first'),
             month=('month', 'first'))
        .reset_index().sort_values('timestamp_utc')
    )
    _poll_sums['rolling_sum'] = _poll_sums['park_sum'].rolling(12, min_periods=6).sum()
    _poll_sums['rolling_n_rides'] = _poll_sums['n_rides'].rolling(12, min_periods=1).min()
    _expected = (
        _poll_sums.groupby(['day_type', 'hour_of_day', 'month'])['rolling_sum'].median()
        .reset_index().rename(columns={'rolling_sum': 'expected_sum'})
    )
    _poll_sums = _poll_sums.merge(_expected, on=['day_type', 'hour_of_day', 'month'], how='left')
    _poll_sums['crowd_level_ratio'] = _poll_sums['rolling_sum'] / _poll_sums['expected_sum']
    _poll_sums.loc[_poll_sums['hour_of_day'] < 10, 'crowd_level_ratio'] = np.nan
    _poll_sums.loc[_poll_sums['rolling_n_rides'] < 8, 'crowd_level_ratio'] = np.nan
    out = df_sorted.merge(_poll_sums[['timestamp_utc', 'crowd_level_ratio']], on='timestamp_utc', how='left')
    return out['crowd_level_ratio']


def notebook_morning_index(df_sorted: pd.DataFrame) -> pd.Series:
    operating = df_sorted[df_sorted['status'] == 'OPERATING'].copy()
    park_open_times = operating.groupby('date_la')['timestamp_utc'].min().rename('park_open_utc').reset_index()
    df_sorted = df_sorted.merge(park_open_times, on='date_la', how='left')
    morning_mask = (
        (df_sorted['status'] == 'OPERATING') & df_sorted['wait_minutes'].notna()
        & (df_sorted['timestamp_utc'] >= df_sorted['park_open_utc'])
        & (df_sorted['timestamp_utc'] <= df_sorted['park_open_utc'] + pd.Timedelta(minutes=120))
    )
    morning_actual = df_sorted[morning_mask].groupby('date_la')['wait_minutes'].median().rename('morning_actual_median').reset_index()
    date_meta = df_sorted[['date_la', 'day_of_week', 'is_holiday']].drop_duplicates('date_la').copy()
    date_meta['month'] = pd.to_datetime(date_meta['date_la'].astype(str)).dt.month
    date_meta['day_type'] = 'weekday'
    date_meta.loc[date_meta['day_of_week'].isin([0, 6]), 'day_type'] = 'weekend'
    date_meta.loc[date_meta['is_holiday'].astype(bool), 'day_type'] = 'holiday'
    morning_actual = morning_actual.merge(date_meta[['date_la', 'day_type', 'month']], on='date_la', how='left')
    morning_expected = (
        morning_actual.groupby(['day_type', 'month'])['morning_actual_median'].median()
        .rename('morning_expected_median').reset_index()
    )
    morning_actual = morning_actual.merge(morning_expected, on=['day_type', 'month'], how='left')
    morning_actual['morning_crowd_index'] = morning_actual['morning_actual_median'] / morning_actual['morning_expected_median']
    return df_sorted.merge(morning_actual[['date_la', 'morning_crowd_index']], on='date_la', how='left')['morning_crowd_index']


# ── Keys ──────────────────────────────────────────────────────────────────────

class TestKeys:
    def test_day_type(self):
        assert day_type(True, 3) == "holiday"   # holiday wins over weekday
        assert day_type(True, 6) == "holiday"
        assert day_type(False, 6) == "weekend"  # Saturday
        assert day_type(False, 0) == "weekend"  # Sunday
        assert day_type(False, 3) == "weekday"  # Wednesday

    def test_park_label(self):
        assert park_label(DL_PARK_ID) == "dl"
        assert park_label(DCA_PARK_ID) == "dca"
        assert park_label("abcdef0123-unknown") == "abcdef01"
        assert park_label("x-id", {"x-id": "xx"}) == "xx"

    def test_crowd_key(self):
        assert crowd_key("weekend", 14) == "weekend|14"
        assert crowd_key("weekend", 14, DCA_PARK_ID, ("park", "day_type", "hour")) == "dca|weekend|14"
        assert crowd_key("weekday", 9, keyed_by=("day_type", "hour", "month"), month=10) == "weekday|9|10"

    def test_morning_key(self):
        assert morning_key("weekday") == "weekday"
        assert morning_key("holiday", DL_PARK_ID, ("park", "day_type")) == "dl|holiday"


# ── crowd_level_ratio, training time ─────────────────────────────────────────

class TestCrowdRatioFrame:
    def test_v0_matches_notebook_cell(self, frame, all_rows):
        ours = crowd_level_ratio_frame(frame, all_rows, ("day_type", "hour", "month"))
        oracle = notebook_crowd_ratio(frame)
        assert ours.notna().sum() > 0
        np.testing.assert_allclose(ours.to_numpy(), oracle.to_numpy(), equal_nan=True)

    def test_before_10am_is_nan(self, frame, all_rows):
        ratio = crowd_level_ratio_frame(frame, all_rows)
        assert ratio[frame["hour_of_day"] < 10].isna().all()
        assert ratio[frame["hour_of_day"] >= 12].notna().all()

    def test_fewer_than_8_rides_is_nan(self, frame, all_rows):
        # DCA loses 2 rides on WED -> 7 rides there; DL keeps 9.
        thin = frame[~((frame["date_la"] == WED) & frame["ride_id"].isin(["dca7", "dca8"]))].reset_index(drop=True)
        fit = pd.Series(True, index=thin.index)
        per_park = crowd_level_ratio_frame(thin, fit, ("park", "day_type", "hour"))
        wed_noon = (thin["date_la"] == WED) & (thin["hour_of_day"] >= 12)
        assert per_park[wed_noon & (thin["park_id"] == DCA_PARK_ID)].isna().all()
        assert per_park[wed_noon & (thin["park_id"] == DL_PARK_ID)].notna().all()

    def test_per_park_differs_from_resort(self, frame, all_rows):
        resort = crowd_level_ratio_frame(frame, all_rows, ("day_type", "hour"))
        per_park = crowd_level_ratio_frame(frame, all_rows, ("park", "day_type", "hour"))
        evening = frame["hour_of_day"] >= 19
        dl = evening & (frame["park_id"] == DL_PARK_ID)
        dca = evening & (frame["park_id"] == DCA_PARK_ID)
        # Resort-wide: both parks share one value per poll. Per park: they differ.
        assert (resort[dl].to_numpy() == resort[dca].to_numpy()).all()
        assert not np.allclose(per_park[dl].to_numpy(), per_park[dca].to_numpy())

    def test_expected_table_uses_only_fit_rows(self, frame):
        fit = frame["date_la"] != WED
        before = crowd_expected_table(frame, fit, ("park", "day_type", "hour"))
        changed = frame.copy()
        changed.loc[changed["date_la"] == WED, "wait_minutes"] *= 3
        after = crowd_expected_table(changed, fit, ("park", "day_type", "hour"))
        assert before == after
        assert before["_meta"] == {
            "keyed_by": ["park", "day_type", "hour"], "version": 2,
            "parks": {DL_PARK_ID: "dl", DCA_PARK_ID: "dca"},
        }
        assert "dca|weekend|14" in before and "weekday|14" not in before
        # And the frame ratio for train days is unaffected by test-day values.
        r1 = crowd_level_ratio_frame(frame, fit, ("park", "day_type", "hour"))
        r2 = crowd_level_ratio_frame(changed, fit, ("park", "day_type", "hour"))
        np.testing.assert_allclose(r1[fit].to_numpy(), r2[fit].to_numpy(), equal_nan=True)


# ── morning_crowd_index, training time ───────────────────────────────────────

class TestMorningFrame:
    def test_v0_matches_notebook_cell(self, frame, all_rows):
        ours = morning_crowd_index_frame(frame, all_rows, ("day_type", "month"))
        np.testing.assert_allclose(ours.to_numpy(), notebook_morning_index(frame).to_numpy(), equal_nan=True)

    def test_per_park_open_time(self, frame, all_rows):
        # Resort-wide window starts 08:00 (DL); DCA's own window starts 08:30,
        # so DCA's per-park window reaches 10:30 and its statistic changes.
        per_park = morning_crowd_index_frame(frame, all_rows, ("park", "day_type"), stat="p75")
        from crowd_features import _morning_actuals
        actual, _ = _morning_actuals(frame, all_rows, ("park", "day_type"), None, "p75")
        dca_wed = frame[(frame["park_id"] == DCA_PARK_ID) & (frame["date_la"] == WED)]
        open_ = dca_wed.loc[dca_wed["status"] == "OPERATING", "timestamp_utc"].min()
        assert open_.tz_convert(LA).strftime("%H:%M") == "08:30"
        win = dca_wed[(dca_wed["timestamp_utc"] >= open_) & (dca_wed["timestamp_utc"] <= open_ + pd.Timedelta(minutes=120))]
        got = actual[(actual["park_id"] == DCA_PARK_ID) & (actual["date_la"] == WED)]["actual"].iloc[0]
        assert got == win["wait_minutes"].quantile(0.75)
        assert per_park.notna().all()

    def test_ride_filter_and_stat(self, frame, all_rows):
        base = morning_expected_table(frame, all_rows, ("day_type",))
        filtered = morning_expected_table(frame, all_rows, ("day_type",), ride_filter=["dl8", "dca8"])
        p75 = morning_expected_table(frame, all_rows, ("day_type",), stat="p75")
        assert filtered["weekday"] > base["weekday"]  # the two busiest rides only
        assert p75["weekday"] > base["weekday"]
        assert filtered["_meta"]["headliner_ride_ids"] == ["dca8", "dl8"]
        assert p75["_meta"]["stat"] == "p75" and "headliner_ride_ids" not in p75["_meta"]

    def test_headliner_ride_ids(self, frame, all_rows):
        med = frame[frame["status"] == "OPERATING"].groupby("ride_id")["wait_minutes"].median()
        expected = sorted(med[med >= 40].index)
        assert 0 < len(expected) < len(med)
        assert headliner_ride_ids(frame, all_rows, min_median=40) == expected


# ── Regime thresholds ─────────────────────────────────────────────────────────

class TestRegimeThresholds:
    def test_keyed_by_name_with_id_fallback(self, frame):
        t = regime_thresholds(frame)
        assert t["_meta"] == {"keyed_by": ["ride_name"], "version": 2}
        base, holiday = t["Haunted Mansion"], t["Haunted Mansion Holiday"]
        assert holiday["p25"] > base["p75"]  # overlay gets its own, higher band
        # dl0's most common name is the base ride (2 of 3 dates).
        assert t[OVERLAY_ID] == base
        assert t["dl3"] == t["DL Ride 3"]

    def test_regime_for(self):
        t = {"Haunted Mansion Holiday": {"p25": 30.0, "p75": 50.0}, "dl0": {"p25": 5.0, "p75": 20.0}}
        assert regime_for(t, "Haunted Mansion Holiday", "dl0") == {"p25": 30.0, "p75": 50.0}
        assert regime_for(t, "Unknown Name", "dl0") == {"p25": 5.0, "p75": 20.0}
        assert regime_for(t, None, "dl0") == {"p25": 5.0, "p75": 20.0}
        assert regime_for(t, float("nan"), "dl0") == {"p25": 5.0, "p75": 20.0}
        assert regime_for(t, "Unknown", "zz9") == {}


# ── Parity (spec R2): training frame vs live at one poll ─────────────────────

class TestParity:
    @pytest.mark.parametrize("keyed_by", [("day_type", "hour"), ("park", "day_type", "hour"), ("day_type", "hour", "month")])
    @pytest.mark.parametrize("hour", [15, 22])
    def test_crowd_ratio(self, frame, keyed_by, hour):
        fit = pd.Series(True, index=frame.index)
        series = crowd_level_ratio_frame(frame, fit, keyed_by)
        table = crowd_expected_table(frame, fit, keyed_by)
        now_la = _at(WED, hour)
        now_utc = pd.Timestamp(now_la).tz_convert("UTC")
        window = frame[(frame["timestamp_utc"] >= now_utc - pd.Timedelta(hours=2)) & (frame["timestamp_utc"] <= now_utc)]
        live = crowd_level_ratio_live(window, now_la, _hol(WED), table)
        assert set(live) == {DL_PARK_ID, DCA_PARK_ID}
        for park in (DL_PARK_ID, DCA_PARK_ID):
            at_poll = series[(frame["timestamp_utc"] == now_utc) & (frame["park_id"] == park)].iloc[0]
            assert live[park] == pytest.approx(at_poll, abs=5e-4)

    @pytest.mark.parametrize("keyed_by,ride_filter,stat", [
        (("day_type",), None, "median"),
        (("day_type", "month"), None, "median"),
        (("park", "day_type"), ["dl5", "dl6", "dl7", "dl8", "dca5", "dca6", "dca7", "dca8"], "p75"),
    ])
    def test_morning_index(self, frame, keyed_by, ride_filter, stat):
        fit = pd.Series(True, index=frame.index)
        series = morning_crowd_index_frame(frame, fit, keyed_by, ride_filter=ride_filter, stat=stat)
        table = morning_expected_table(frame, fit, keyed_by, ride_filter=ride_filter, stat=stat)
        now_la = _at(WED, 14)
        today = frame[frame["date_la"] == WED]
        live = morning_crowd_index_live(today, now_la, _hol(WED), table)
        for park in (DL_PARK_ID, DCA_PARK_ID):
            expected = series[(frame["date_la"] == WED) & (frame["park_id"] == park)].iloc[0]
            assert live[park] == pytest.approx(expected, abs=5e-4)


# ── Serving edge cases and legacy JSONs ──────────────────────────────────────

class TestLive:
    def _window(self, frame, now_la):
        now_utc = pd.Timestamp(now_la).tz_convert("UTC")
        return frame[(frame["timestamp_utc"] >= now_utc - pd.Timedelta(hours=2)) & (frame["timestamp_utc"] <= now_utc)]

    def test_legacy_crowd_json(self, frame):
        now_la = _at(WED, 14)
        window = self._window(frame, now_la)
        last12 = sorted(window["timestamp_utc"].unique())[-12:]
        actual = window[window["timestamp_utc"].isin(last12) & (window["status"] == "OPERATING")]["wait_minutes"].sum()
        live = crowd_level_ratio_live(window, now_la, _hol(WED), {"weekday_14_9": 4000.0})
        assert live == {DL_PARK_ID: round(actual / 4000.0, 3), DCA_PARK_ID: round(actual / 4000.0, 3)}

    def test_legacy_morning_json(self, frame):
        today = frame[frame["date_la"] == WED]
        open_ = today.loc[today["status"] == "OPERATING", "timestamp_utc"].min()
        win = today[(today["status"] == "OPERATING") & (today["timestamp_utc"] <= open_ + pd.Timedelta(minutes=120))]
        live = morning_crowd_index_live(today, _at(WED, 14), _hol(WED), {"weekday_9": 25.0})
        assert live[DL_PARK_ID] == live[DCA_PARK_ID] == round(win["wait_minutes"].median() / 25.0, 3)

    def test_unknown_key_is_none_and_warns_once(self, frame, caplog):
        table = {"_meta": {"keyed_by": ["park", "day_type", "hour"], "version": 2,
                           "parks": {DL_PARK_ID: "dl", DCA_PARK_ID: "dca"}}, "dl|weekday|14": 3000.0}
        now_la = _at(WED, 14)
        with caplog.at_level("WARNING"):
            live = crowd_level_ratio_live(self._window(frame, now_la), now_la, _hol(WED), table)
        assert live[DL_PARK_ID] is not None and live[DCA_PARK_ID] is None
        assert [r.getMessage() for r in caplog.records] == ["crowd baseline miss: dca|weekday|14"]

    def test_cold_start_and_empty(self, frame):
        now_la = _at(WED, 9, 30)
        assert crowd_level_ratio_live(self._window(frame, now_la), now_la, _hol(WED), {"weekday_9_9": 1.0}) == {
            DL_PARK_ID: None, DCA_PARK_ID: None}
        assert crowd_level_ratio_live(pd.DataFrame(), now_la, _hol(WED), {}) == {}
        # Morning: DCA opened 08:30, so at 10:15 DL (08:00) has a full window and DCA does not.
        table = morning_expected_table(frame, pd.Series(True, index=frame.index), ("park", "day_type"))
        today = frame[(frame["date_la"] == WED) & (frame["timestamp_utc"] <= pd.Timestamp(_at(WED, 10, 15)))]
        live = morning_crowd_index_live(today, _at(WED, 10, 15), _hol(WED), table)
        assert live[DL_PARK_ID] is not None and live[DCA_PARK_ID] is None
        assert morning_crowd_index_live(pd.DataFrame(), now_la, _hol(WED), table) == {}
