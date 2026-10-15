"""Train/test splits and row groupings used by every evaluation.

The forward split is the one that gates deploys: the model trains on days
strictly before the cutoff and is scored on the calendar days after it, so it
has never seen the test weeks. The interleaved split reproduces the notebook's
old `test_day_mask` (every 5th day by ordinal) and exists only so the two can
be compared side by side.

    import sys; sys.path.insert(0, '.')
    from ml.splits import forward_split
    train, test = forward_split(df_sorted, weeks=4)
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

WEEKEND_DOW = {0, 6}  # JS convention: Sunday = 0, Saturday = 6
WAIT_BANDS = ["<=10", "11-25", "26-60", ">60"]


def forward_split(
    df: pd.DataFrame, weeks: int = 4, cutoff: date | None = None
) -> tuple[pd.Series, pd.Series]:
    """(train_mask, test_mask) by `date_la`.

    test  = days in (cutoff, cutoff + weeks]; train = days <= cutoff.
    With no cutoff, the test window is the last `weeks` of calendar days in
    the frame. With an explicit cutoff, days beyond the window are in neither.
    """
    dates = df["date_la"]
    if cutoff is None:
        cutoff = dates.max() - timedelta(weeks=weeks)
    end = cutoff + timedelta(weeks=weeks)
    train = (dates <= cutoff).astype(bool)
    test = ((dates > cutoff) & (dates <= end)).astype(bool)
    return train, test


def interleaved_split(df: pd.DataFrame, every_n: int = 5) -> tuple[pd.Series, pd.Series]:
    """(train_mask, test_mask): the notebook's every-Nth-day split. Comparison only."""
    test = df["date_la"].map(lambda d: d.toordinal() % every_n == 0).astype(bool)
    return ~test, test


def day_type(df: pd.DataFrame) -> pd.Series:
    """'holiday' | 'weekend' | 'weekday', matching the notebook's classify_day_type."""
    is_weekend = df["day_of_week"].isin(WEEKEND_DOW)
    values = np.select(
        [df["is_holiday"].astype(bool), is_weekend], ["holiday", "weekend"], default="weekday"
    )
    return pd.Series(values, index=df.index, name="day_type")


def wait_band(wait: pd.Series) -> pd.Series:
    """Current-wait band: '<=10', '11-25', '26-60', '>60' (NaN stays NaN)."""
    return pd.cut(wait, bins=[-np.inf, 10, 25, 60, np.inf], labels=WAIT_BANDS).rename("wait_band")
