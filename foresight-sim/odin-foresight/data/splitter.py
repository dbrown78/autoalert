"""
data/splitter.py

Vehicle-level train/val/test split.

CRITICAL: splits must be at the VEHICLE level, not the ROW level.
If we split randomly by row, the model sees vehicle A's day-1 data in
training and vehicle A's day-2 data in validation — that's data leakage.
The model would learn vehicle identity, not failure patterns.

Split strategy:
  - Group vehicles by label distribution (some all-healthy, some with failure)
  - Stratified split: each split has similar positive/negative ratio
  - All days for a given vehicle go to the same split

Default split: 70% train / 15% val / 15% test
"""

from __future__ import annotations
import logging
from typing import Tuple

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)


def vehicle_level_split(
    df: pd.DataFrame,
    train_frac: float = 0.70,
    val_frac: float = 0.15,
    seed: int = 42,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Split df into train/val/test at the vehicle level.

    df must have a 'vehicle_id' column and a 'label_binary' column.
    Returns (train_df, val_df, test_df).
    """
    if "vehicle_id" not in df.columns:
        raise ValueError("df must have a 'vehicle_id' column")
    if "label_binary" not in df.columns:
        raise ValueError("df must have a 'label_binary' column")

    rng = np.random.default_rng(seed)

    # Get per-vehicle label: 1 if vehicle has ANY positive-label days
    vehicle_labels = (
        df.groupby("vehicle_id")["label_binary"]
        .max()
        .reset_index()
        .rename(columns={"label_binary": "has_failure"})
    )

    failure_vehicles = vehicle_labels[vehicle_labels["has_failure"] == 1]["vehicle_id"].values
    healthy_vehicles = vehicle_labels[vehicle_labels["has_failure"] == 0]["vehicle_id"].values

    def split_group(vehicles: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        rng.shuffle(vehicles)
        n = len(vehicles)
        n_train = int(n * train_frac)
        n_val = int(n * val_frac)
        return (
            vehicles[:n_train],
            vehicles[n_train:n_train + n_val],
            vehicles[n_train + n_val:],
        )

    # Split failure and healthy vehicles separately to preserve ratio
    f_train, f_val, f_test = split_group(failure_vehicles)
    h_train, h_val, h_test = split_group(healthy_vehicles)

    train_ids = np.concatenate([f_train, h_train])
    val_ids   = np.concatenate([f_val,   h_val])
    test_ids  = np.concatenate([f_test,  h_test])

    train_df = df[df["vehicle_id"].isin(train_ids)].copy()
    val_df   = df[df["vehicle_id"].isin(val_ids)].copy()
    test_df  = df[df["vehicle_id"].isin(test_ids)].copy()

    _log_split(train_df, val_df, test_df)
    return train_df, val_df, test_df


def _log_split(train_df, val_df, test_df):
    def stats(df, name):
        vehicles = df["vehicle_id"].nunique()
        rows = len(df)
        pos_rate = df["label_binary"].mean() if len(df) > 0 else 0
        log.info(
            f"  {name:<6}: {vehicles:>4} vehicles | "
            f"{rows:>8,} rows | "
            f"{pos_rate:.1%} positive"
        )
    log.info("Dataset split:")
    stats(train_df, "Train")
    stats(val_df,   "Val")
    stats(test_df,  "Test")


def extract_xy(
    df: pd.DataFrame,
    feature_cols: list[str],
    label_col: str = "label_binary",
) -> Tuple[pd.DataFrame, pd.Series]:
    """Extract feature matrix X and label vector y from a split DataFrame."""
    X = df[feature_cols].copy().fillna(0)
    y = df[label_col].copy()
    return X, y
