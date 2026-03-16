"""
data/loader.py

Pulls sim data from PostgreSQL and returns DataFrames ready for
feature engineering.

Two-step load:
  1. Load daily sensor aggregates (mean/std/min/max per sensor per vehicle per day)
     from sensor_readings WHERE source LIKE 'sim%'
  2. Load labels from sim_day_labels
  3. Join on (vehicle_id, day)
  4. Load vehicle metadata from sim_vehicles for age/mileage features

The aggregation is done in SQL — much faster than loading raw rows
and aggregating in pandas. A 50-vehicle × 90-day dataset has ~4B raw
sensor readings but only 50 × 90 × 12 = 54,000 aggregated rows.
"""

from __future__ import annotations
import os
import logging
from typing import Optional

import pandas as pd
import psycopg2
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")


def _get_conn():
    if not DATABASE_URL:
        raise EnvironmentError(
            "DATABASE_URL not set. Add it to odin-foresight/.env"
        )
    return psycopg2.connect(DATABASE_URL)


# ── SQL Queries ───────────────────────────────────────────────────────────────

# Aggregate sensor readings to per-(vehicle, day, sensor) stats
SENSOR_AGG_QUERY = """
SELECT
    vehicle_id,
    day,
    sensor_name,
    AVG(value)    AS mean_val,
    STDDEV(value) AS std_val,
    MIN(value)    AS min_val,
    MAX(value)    AS max_val,
    COUNT(*)      AS sample_count
FROM sim_sensor_readings
WHERE 1=1
  {vehicle_filter}
GROUP BY vehicle_id, day, sensor_name
ORDER BY vehicle_id, day, sensor_name
"""

LABELS_QUERY = """
SELECT
    vehicle_id,
    day,
    failure_mode,
    dtc_code,
    degradation_factor,
    days_to_dtc,
    label_binary,
    label_severity
FROM sim_day_labels
ORDER BY vehicle_id, day
"""

VEHICLE_META_QUERY = """
SELECT
    vehicle_id,
    make_model,
    year,
    mileage_km,
    base_health,
    archetype,
    is_demo
FROM sim_vehicles
"""

COUNT_QUERY = """
SELECT
    (SELECT COUNT(*) FROM sim_sensor_readings)              AS sensor_readings,
    (SELECT COUNT(*) FROM sim_day_labels)                   AS day_labels,
    (SELECT COUNT(*) FROM sim_failure_events)               AS failure_events,
    (SELECT COUNT(DISTINCT vehicle_id) FROM sim_day_labels) AS vehicles
"""


def check_data_availability() -> dict:
    """Return row counts for all sim tables. Used by check_data.py script."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(COUNT_QUERY)
            row = cur.fetchone()
            return {
                "sensor_readings": row[0],
                "day_labels": row[1],
                "failure_events": row[2],
                "vehicles": row[3],
            }
    finally:
        conn.close()


def load_raw(
    vehicle_ids: Optional[list] = None,
    demo_only: bool = False,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Load raw aggregated data from PostgreSQL.

    Returns:
        sensor_df  — per (vehicle_id, day, sensor_name) aggregated stats
        labels_df  — per (vehicle_id, day) ML labels
        vehicle_df — per vehicle_id metadata
    """
    log.info("Loading sim data from PostgreSQL...")
    conn = _get_conn()

    try:
        # Build optional vehicle filter
        if vehicle_ids:
            placeholders = ",".join(["%s"] * len(vehicle_ids))
            vehicle_filter = f"AND vehicle_id IN ({placeholders})"
        elif demo_only:
            vehicle_filter = "AND vehicle_id LIKE 'DEMO-%%'"
        else:
            vehicle_filter = ""

        agg_sql = SENSOR_AGG_QUERY.format(vehicle_filter=vehicle_filter)

        if vehicle_ids:
            sensor_df = pd.read_sql(agg_sql, conn, params=vehicle_ids)
        else:
            sensor_df = pd.read_sql(agg_sql, conn)

        labels_df  = pd.read_sql(LABELS_QUERY, conn)
        vehicle_df = pd.read_sql(VEHICLE_META_QUERY, conn)

        log.info(
            f"Loaded: {len(sensor_df):,} sensor-day rows | "
            f"{len(labels_df):,} label rows | "
            f"{len(vehicle_df)} vehicles"
        )
        return sensor_df, labels_df, vehicle_df

    finally:
        conn.close()


def pivot_sensors(sensor_df: pd.DataFrame) -> pd.DataFrame:
    """
    Pivot sensor_df from long format (one row per sensor) to wide format
    (one row per vehicle+day, one column per sensor×stat).

    Input:  vehicle_id, day, sensor_name, mean_val, std_val, min_val, max_val
    Output: vehicle_id, day, rpm_mean, rpm_std, rpm_min, rpm_max,
                             coolant_temp_mean, ... (12 sensors × 4 stats = 48 cols)
    """
    stat_cols = ["mean_val", "std_val", "min_val", "max_val"]
    pivots = []

    for stat in stat_cols:
        suffix = stat.replace("_val", "")
        pivoted = sensor_df.pivot_table(
            index=["vehicle_id", "day"],
            columns="sensor_name",
            values=stat,
            aggfunc="first",
        )
        pivoted.columns = [f"{col}_{suffix}" for col in pivoted.columns]
        pivots.append(pivoted)

    wide = pd.concat(pivots, axis=1).reset_index()
    log.info(f"Pivoted to wide: {wide.shape[0]:,} rows × {wide.shape[1]} columns")
    return wide


def load_and_pivot(
    vehicle_ids: Optional[list] = None,
    demo_only: bool = False,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Convenience function: load + pivot in one call.
    Returns (wide_sensor_df, labels_df joined with vehicle metadata).
    """
    sensor_df, labels_df, vehicle_df = load_raw(vehicle_ids, demo_only)

    # Pivot sensors to wide format
    wide = pivot_sensors(sensor_df)

    # Merge labels
    merged = wide.merge(labels_df, on=["vehicle_id", "day"], how="left")

    # Merge vehicle metadata
    merged = merged.merge(vehicle_df, on="vehicle_id", how="left")

    log.info(f"Merged dataset: {merged.shape[0]:,} rows × {merged.shape[1]} columns")
    return merged, labels_df
