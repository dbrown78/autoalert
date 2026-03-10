#!/usr/bin/env python3
"""
foresight/feature_engineer.py

Queries sensor_readings from PostgreSQL and engineers rolling features
for the GBM model. Called by the FastAPI prediction service.

Features produced per sensor (mirrors iDharshan repo + Microsoft PM playbook):
  - mean_1h, std_1h, min_1h, max_1h
  - mean_24h, std_24h
  - latest (most recent clean value)
  - trend_slope (linear regression slope over last 1hr readings)
  - temp_difference (coolant_temp - intake_air_temp, key derived feature)
"""

import os
import numpy as np
import pandas as pd
from sqlalchemy import create_engine, text
from scipy.stats import linregress
from datetime import datetime, timezone

DATABASE_URL = os.environ.get("DATABASE_URL")  # set in .env

engine = create_engine(DATABASE_URL)

SENSORS = [
    "engine_rpm",
    "coolant_temp",
    "lub_oil_temp",
    "battery_voltage",
    "fuel_pressure",
    "lub_oil_pressure",
    "coolant_pressure",
    "intake_air_temp",
    "throttle_position",
]


def fetch_sensor_history(vehicle_id: int, hours: int = 24) -> pd.DataFrame:
    """Pull recent sensor readings for a vehicle from Postgres."""
    sql = text("""
        SELECT sensor_type, value, recorded_at
        FROM sensor_readings
        WHERE vehicle_id = :vid
          AND recorded_at > NOW() - INTERVAL ':hours hours'
          AND quality >= 1
        ORDER BY recorded_at ASC
    """)
    # SQLAlchemy text() doesn't interpolate in INTERVAL — use string format safely
    sql = text(f"""
        SELECT sensor_type, value::float, recorded_at
        FROM sensor_readings
        WHERE vehicle_id = :vid
          AND recorded_at > NOW() - INTERVAL '{hours} hours'
          AND quality >= 1
        ORDER BY recorded_at ASC
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"vid": vehicle_id})
    return df


def compute_slope(values: np.ndarray) -> float:
    """Compute linear regression slope as a trend indicator."""
    if len(values) < 2:
        return 0.0
    x = np.arange(len(values), dtype=float)
    slope, _, _, _, _ = linregress(x, values)
    return float(slope)


def engineer_features(vehicle_id: int) -> dict:
    """
    Main entry point. Returns a flat feature dict ready for GBM input.

    Returns:
        dict with keys like 'coolant_temp_mean_1h', 'engine_rpm_slope_1h', etc.
        Also includes 'temp_difference_latest' as a derived feature.
        Returns None if insufficient data.
    """
    df = fetch_sensor_history(vehicle_id, hours=24)

    if df.empty:
        return None

    now = pd.Timestamp.now(tz="UTC")
    cutoff_1h  = now - pd.Timedelta(hours=1)
    cutoff_24h = now - pd.Timedelta(hours=24)

    features = {}

    for sensor in SENSORS:
        sensor_df = df[df["sensor_type"] == sensor].copy()
        sensor_df["recorded_at"] = pd.to_datetime(sensor_df["recorded_at"], utc=True)

        vals_1h  = sensor_df[sensor_df["recorded_at"] >= cutoff_1h]["value"].values
        vals_24h = sensor_df[sensor_df["recorded_at"] >= cutoff_24h]["value"].values

        # 1-hour rolling features
        features[f"{sensor}_mean_1h"]  = float(np.mean(vals_1h))  if len(vals_1h) else np.nan
        features[f"{sensor}_std_1h"]   = float(np.std(vals_1h))   if len(vals_1h) > 1 else 0.0
        features[f"{sensor}_min_1h"]   = float(np.min(vals_1h))   if len(vals_1h) else np.nan
        features[f"{sensor}_max_1h"]   = float(np.max(vals_1h))   if len(vals_1h) else np.nan
        features[f"{sensor}_slope_1h"] = compute_slope(vals_1h)

        # 24-hour rolling features
        features[f"{sensor}_mean_24h"] = float(np.mean(vals_24h)) if len(vals_24h) else np.nan
        features[f"{sensor}_std_24h"]  = float(np.std(vals_24h))  if len(vals_24h) > 1 else 0.0

        # Latest value
        latest = sensor_df.sort_values("recorded_at").tail(1)["value"].values
        features[f"{sensor}_latest"] = float(latest[0]) if len(latest) else np.nan

    # Derived: temp_difference (key feature from iDharshan repo)
    c = features.get("coolant_temp_latest", np.nan)
    i = features.get("intake_air_temp_latest", np.nan)
    features["temp_difference_latest"] = (c - i) if (not np.isnan(c) and not np.isnan(i)) else np.nan

    # Count of valid sensors (data quality signal)
    valid_count = sum(1 for k, v in features.items() if k.endswith("_latest") and not np.isnan(v))
    features["valid_sensor_count"] = valid_count

    return features


if __name__ == "__main__":
    import json, sys
    vid = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    feats = engineer_features(vid)
    print(json.dumps(feats, indent=2, default=str))
