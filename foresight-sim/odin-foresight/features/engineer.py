"""
features/engineer.py

Feature engineering pipeline. Takes the wide-format merged DataFrame
from data/loader.py and adds:

  1. Vehicle metadata features (age, mileage, health)
  2. Sensor ratio features (RPM/MAF load proxy, fuel trim delta)
  3. O2 oscillation range (key signal for cat/O2 failures)
  4. Temporal features (day of simulation, normalized)
  5. Rolling lag features (day-over-day change in sensor means)

All features are designed to be available at inference time from
the last N days of real sensor readings — no future data used.
"""

from __future__ import annotations
import logging
from typing import List

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

# Current year for age calculation
CURRENT_YEAR = 2024


def add_vehicle_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add vehicle-level metadata as features."""
    df = df.copy()

    if "year" in df.columns:
        df["vehicle_age_years"] = CURRENT_YEAR - df["year"]
    else:
        df["vehicle_age_years"] = 5  # Default

    if "mileage_km" in df.columns:
        df["mileage_km_norm"] = df["mileage_km"] / 300_000  # Normalize to 0-1
    else:
        df["mileage_km_norm"] = 0.5

    if "base_health" in df.columns:
        df["base_health_inv"] = 1.0 - df["base_health"]  # Invert: higher = worse
    else:
        df["base_health_inv"] = 0.15

    return df


def add_derived_sensor_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add engineered features derived from sensor combinations.
    These capture relationships between sensors that degrade together.
    """
    df = df.copy()

    # Engine load proxy: RPM / MAF — higher = engine working harder per unit air
    if "rpm_mean" in df.columns and "maf_mean" in df.columns:
        safe_maf = df["maf_mean"].replace(0, np.nan)
        df["rpm_to_maf_ratio"] = (df["rpm_mean"] / safe_maf).fillna(0).clip(0, 500)

    # Fuel trim delta: long_trim - short_trim
    # Large positive delta = ECU has been compensating for a long time (lean condition)
    if "long_fuel_trim_mean" in df.columns and "short_fuel_trim_mean" in df.columns:
        df["fuel_trim_delta"] = df["long_fuel_trim_mean"] - df["short_fuel_trim_mean"]

    # O2 upstream oscillation range: max - min
    # Healthy upstream O2 oscillates widely. Failing one: range narrows.
    if "o2_voltage_b1s1_max" in df.columns and "o2_voltage_b1s1_min" in df.columns:
        df["o2_b1s1_range"] = df["o2_voltage_b1s1_max"] - df["o2_voltage_b1s1_min"]

    # O2 downstream stability: std of downstream O2
    # Healthy downstream is stable. Cat failing: std increases (mirrors upstream)
    if "o2_voltage_b1s2_std" in df.columns:
        df["o2_b1s2_instability"] = df["o2_voltage_b1s2_std"]

    # Coolant temp variability: high std = thermostat or sensor issue
    if "coolant_temp_std" in df.columns:
        df["coolant_variability"] = df["coolant_temp_std"]

    # Battery voltage headroom: distance from critical floor
    if "battery_voltage_min" in df.columns:
        df["battery_headroom"] = (df["battery_voltage_min"] - 10.5).clip(0, 6)

    # Catalyst temp to RPM ratio: cat running hot relative to engine load
    if "catalyst_temp_mean" in df.columns and "rpm_mean" in df.columns:
        safe_rpm = df["rpm_mean"].replace(0, np.nan)
        df["cat_temp_per_rpm"] = (df["catalyst_temp_mean"] / safe_rpm).fillna(0).clip(0, 1)

    return df


def add_temporal_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add simulation-day features."""
    df = df.copy()
    if "day" in df.columns:
        max_day = df["day"].max() or 1
        df["day_normalized"] = df["day"] / max_day
    return df


def add_lag_features(df: pd.DataFrame, sensor_means: List[str], lag_days: int = 3) -> pd.DataFrame:
    """
    Add day-over-day change features for sensor means.
    For each sensor mean column, compute the change from lag_days ago.
    This captures the RATE of deterioration, not just the current level.

    Requires df to be sorted by (vehicle_id, day) — loader guarantees this.
    """
    df = df.copy().sort_values(["vehicle_id", "day"])

    for col in sensor_means:
        if col not in df.columns:
            continue
        lag_col = f"{col}_lag{lag_days}d"
        delta_col = f"{col}_delta{lag_days}d"
        df[lag_col]   = df.groupby("vehicle_id")[col].shift(lag_days)
        df[delta_col] = df[col] - df[lag_col]

    return df


def get_feature_columns(df: pd.DataFrame) -> List[str]:
    """
    Return the list of columns to use as ML features.
    Excludes ID columns, label columns, and raw metadata strings.
    """
    exclude = {
        "vehicle_id", "day", "make_model", "archetype",
        "failure_mode", "dtc_code", "degradation_factor",
        "days_to_dtc", "label_binary", "label_severity",
        "year", "mileage_km", "base_health", "is_demo",
        "has_failure",
    }
    return [c for c in df.columns if c not in exclude]


def build_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """
    Full feature engineering pipeline. Takes the merged wide DataFrame
    and returns a feature-rich DataFrame ready for train/val/test split.
    """
    log.info(f"Building features from {len(df):,} rows × {df.shape[1]} columns")

    sensor_mean_cols = [c for c in df.columns if c.endswith("_mean")]

    df = add_vehicle_features(df)
    df = add_derived_sensor_features(df)
    df = add_temporal_features(df)
    df = add_lag_features(df, sensor_mean_cols, lag_days=3)
    df = add_lag_features(df, sensor_mean_cols, lag_days=7)

    # Fill NaNs (lag features will be NaN for first N days)
    feature_cols = get_feature_columns(df)
    df[feature_cols] = df[feature_cols].fillna(0)

    log.info(f"Feature matrix: {len(df):,} rows × {len(feature_cols)} features")
    return df


def describe_features(df: pd.DataFrame) -> str:
    """Return a summary table of feature statistics for inspection."""
    feature_cols = get_feature_columns(df)
    X = df[feature_cols].fillna(0)
    stats = X.describe().T[["mean", "std", "min", "max"]]
    stats["nan_pct"] = X.isnull().mean()
    lines = [
        f"{'Feature':<45} {'Mean':>10} {'Std':>10} {'Min':>10} {'Max':>10} {'NaN%':>7}",
        "─" * 95,
    ]
    for feat, row in stats.iterrows():
        lines.append(
            f"  {feat:<43} {row['mean']:>10.3f} {row['std']:>10.3f} "
            f"{row['min']:>10.3f} {row['max']:>10.3f} {row['nan_pct']:>6.1%}"
        )
    return "\n".join(lines)
