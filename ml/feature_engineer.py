"""
feature_engineer.py — Extract ML features from sensor_readings for a vehicle.

Called by foresight_service.py at prediction time.
Feature set matches the columns used during training in train_foresight.py.
"""

import os
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Sensors and the statistics to compute for each
SENSOR_STATS: dict[str, list[str]] = {
    "coolant_temp":  ["mean", "std", "max", "p95"],
    "voltage":       ["mean", "std", "min"],
    "fuel_trim":     ["mean", "std"],
    "o2_sensor":     ["mean", "std"],
    "rpm":           ["mean", "max", "p95"],
    "engine_load":   ["mean", "max", "p95"],
    "intake_temp":   ["mean"],
}

# Canonical ordered feature list — must match train_foresight.py
FEATURE_NAMES: list[str] = [
    "coolant_temp_mean", "coolant_temp_std", "coolant_temp_max", "coolant_temp_p95",
    "voltage_mean",      "voltage_std",      "voltage_min",
    "fuel_trim_mean",    "fuel_trim_std",    "fuel_trim_abs_mean",
    "o2_sensor_mean",    "o2_sensor_std",
    "rpm_mean",          "rpm_max",          "rpm_p95",
    "engine_load_mean",  "engine_load_max",  "engine_load_p95",
    "intake_temp_mean",
    "reading_count",
]


def _stat(values: np.ndarray, stat: str) -> float:
    if len(values) == 0:
        return 0.0
    if stat == "mean":
        return float(np.mean(values))
    if stat == "std":
        return float(np.std(values))
    if stat == "max":
        return float(np.max(values))
    if stat == "min":
        return float(np.min(values))
    if stat == "p95":
        return float(np.percentile(values, 95))
    return 0.0


def extract_features(vehicle_id: int, hours: int = 24) -> tuple[dict | None, str]:
    """
    Query sensor_readings for the last `hours` hours and compute ML features.

    Returns:
        (features_dict, data_quality)  — features_dict is None if insufficient data.

    data_quality: 'insufficient' | 'limited' | 'good' | 'excellent'
    """
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL env var is not set")

    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    conn = psycopg2.connect(DATABASE_URL)
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute(
            """
            SELECT sensor_type, value
            FROM sensor_readings
            WHERE vehicle_id = %s AND recorded_at > %s
            """,
            (vehicle_id, since),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        return None, "insufficient"

    # Group values by sensor type
    sensor_values: dict[str, list[float]] = {}
    for row in rows:
        sensor_values.setdefault(row["sensor_type"], []).append(float(row["value"]))

    reading_count = sum(len(v) for v in sensor_values.values())
    if reading_count < 10:
        return None, "insufficient"

    # Compute statistics
    features: dict[str, float] = {"reading_count": float(reading_count)}

    for sensor, stats in SENSOR_STATS.items():
        arr = np.array(sensor_values.get(sensor, []))
        for stat in stats:
            features[f"{sensor}_{stat}"] = _stat(arr, stat)

    # Derived feature — absolute mean fuel trim
    features["fuel_trim_abs_mean"] = abs(features.get("fuel_trim_mean", 0.0))

    # Data quality tier
    if reading_count < 50:
        quality = "limited"
    elif reading_count < 200:
        quality = "good"
    else:
        quality = "excellent"

    return features, quality
