"""
sim/db.py
PostgreSQL writer. Matches the AutoAlert backend sensor_readings schema.
Supports migrations (creates tables if they don't exist) and batch inserts.

Run migrations:
    python sim/db.py --migrate

All sim data is tagged with source='sim' so it can be filtered from real
user data at query time. Demo vehicles use vehicle_id prefix 'DEMO-'.
"""

import os
import sys
import argparse
import psycopg2
import psycopg2.extras
from datetime import datetime
from typing import List
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")


MIGRATION_SQL = """
-- Sim vehicle registry
CREATE TABLE IF NOT EXISTS sim_vehicles (
    vehicle_id      VARCHAR(64) PRIMARY KEY,
    make_model      VARCHAR(128) NOT NULL,
    year            INTEGER,
    mileage         INTEGER,
    driving_profile VARCHAR(32),
    base_health     FLOAT,
    archetype       VARCHAR(64),
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Core sensor readings table (shared with real data, distinguished by source)
CREATE TABLE IF NOT EXISTS sensor_readings (
    id                  BIGSERIAL PRIMARY KEY,
    vehicle_id          VARCHAR(64) NOT NULL,
    timestamp           TIMESTAMP NOT NULL,
    day                 INTEGER,
    sensor_name         VARCHAR(64) NOT NULL,
    value               FLOAT NOT NULL,
    unit                VARCHAR(16),
    is_healthy          BOOLEAN DEFAULT TRUE,
    degradation_factor  FLOAT DEFAULT 0.0,
    source              VARCHAR(32) DEFAULT 'real',  -- 'sim' | 'sim_dtc_PXXXX' | 'real'
    created_at          TIMESTAMP DEFAULT NOW()
);

-- Index for fast time-series queries per vehicle
CREATE INDEX IF NOT EXISTS idx_sensor_readings_vehicle_time
    ON sensor_readings (vehicle_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_source
    ON sensor_readings (source);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_sensor
    ON sensor_readings (sensor_name, vehicle_id);

-- Sim failure events — ground truth labels for model training
CREATE TABLE IF NOT EXISTS sim_failure_events (
    id                  BIGSERIAL PRIMARY KEY,
    vehicle_id          VARCHAR(64) NOT NULL,
    failure_mode        VARCHAR(64) NOT NULL,
    dtc_code            VARCHAR(16),
    failure_start_day   INTEGER,
    dtc_fire_day        INTEGER,
    total_sim_days      INTEGER,
    repair_cost_oem_min INTEGER,
    repair_cost_oem_max INTEGER,
    repair_cost_am_min  INTEGER,
    repair_cost_am_max  INTEGER,
    created_at          TIMESTAMP DEFAULT NOW()
);
"""


def get_connection():
    if not DATABASE_URL:
        raise EnvironmentError(
            "DATABASE_URL not set. Add it to your .env file.\n"
            "Example: DATABASE_URL=postgresql://user:pass@localhost:5432/autoalert"
        )
    return psycopg2.connect(DATABASE_URL)


def run_migrations():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(MIGRATION_SQL)
        conn.commit()
        print("✓ Migrations applied successfully.")
    finally:
        conn.close()


def insert_vehicle(profile, archetype: str = "unknown"):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO sim_vehicles (vehicle_id, make_model, year, mileage, driving_profile, base_health, archetype)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (vehicle_id) DO UPDATE SET
                    mileage = EXCLUDED.mileage,
                    base_health = EXCLUDED.base_health
            """, (
                profile.vehicle_id,
                profile.make_model,
                profile.year,
                profile.mileage,
                profile.driving_profile,
                profile.base_health,
                archetype,
            ))
        conn.commit()
    finally:
        conn.close()


def insert_readings_batch(readings: list, batch_size: int = 5000):
    """
    Batch insert sensor readings. Groups into chunks of batch_size for efficiency.
    readings: list of TelemetryReading objects
    """
    if not readings:
        return 0

    conn = get_connection()
    total_inserted = 0

    try:
        with conn.cursor() as cur:
            for i in range(0, len(readings), batch_size):
                chunk = readings[i:i + batch_size]
                records = [
                    (
                        r.vehicle_id,
                        r.timestamp,
                        r.day,
                        r.sensor_name,
                        r.value,
                        r.unit,
                        r.is_healthy,
                        r.degradation_factor,
                        r.source,
                    )
                    for r in chunk
                ]
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO sensor_readings
                        (vehicle_id, timestamp, day, sensor_name, value, unit, is_healthy, degradation_factor, source)
                    VALUES %s
                    """,
                    records,
                    template="(%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    page_size=batch_size,
                )
                total_inserted += len(chunk)

        conn.commit()
    finally:
        conn.close()

    return total_inserted


def insert_failure_event(vehicle_id: str, injector_summary: dict, total_sim_days: int):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO sim_failure_events
                    (vehicle_id, failure_mode, dtc_code, failure_start_day, dtc_fire_day,
                     total_sim_days, repair_cost_oem_min, repair_cost_oem_max,
                     repair_cost_am_min, repair_cost_am_max)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                vehicle_id,
                injector_summary["failure_mode"],
                injector_summary["dtc_code"],
                injector_summary["failure_start_day"],
                injector_summary.get("dtc_fire_day"),
                total_sim_days,
                injector_summary["repair_cost_oem"][0],
                injector_summary["repair_cost_oem"][1],
                injector_summary["repair_cost_aftermarket"][0],
                injector_summary["repair_cost_aftermarket"][1],
            ))
        conn.commit()
    finally:
        conn.close()


def clear_sim_data(vehicle_id: str = None):
    """Remove sim data. If vehicle_id given, only that vehicle. Otherwise all sim data."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            if vehicle_id:
                cur.execute("DELETE FROM sensor_readings WHERE vehicle_id = %s AND source LIKE 'sim%'", (vehicle_id,))
                cur.execute("DELETE FROM sim_failure_events WHERE vehicle_id = %s", (vehicle_id,))
                cur.execute("DELETE FROM sim_vehicles WHERE vehicle_id = %s", (vehicle_id,))
            else:
                cur.execute("DELETE FROM sensor_readings WHERE source LIKE 'sim%'")
                cur.execute("DELETE FROM sim_failure_events")
                cur.execute("DELETE FROM sim_vehicles")
        conn.commit()
        print(f"✓ Sim data cleared{' for ' + vehicle_id if vehicle_id else ''}.")
    finally:
        conn.close()


def count_sim_readings() -> dict:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM sensor_readings WHERE source LIKE 'sim%'")
            total = cur.fetchone()[0]
            cur.execute("SELECT COUNT(DISTINCT vehicle_id) FROM sensor_readings WHERE source LIKE 'sim%'")
            vehicles = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM sim_failure_events")
            events = cur.fetchone()[0]
        return {"total_readings": total, "vehicles": vehicles, "failure_events": events}
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ODIN Sim DB Utilities")
    parser.add_argument("--migrate", action="store_true", help="Run DB migrations")
    parser.add_argument("--stats", action="store_true", help="Show sim data stats")
    parser.add_argument("--clear", action="store_true", help="Clear all sim data")
    parser.add_argument("--vehicle", type=str, help="Filter by vehicle_id")
    args = parser.parse_args()

    if args.migrate:
        run_migrations()
    elif args.stats:
        stats = count_sim_readings()
        print(f"Sim readings: {stats['total_readings']:,}")
        print(f"Sim vehicles: {stats['vehicles']}")
        print(f"Failure events: {stats['failure_events']}")
    elif args.clear:
        clear_sim_data(args.vehicle)
    else:
        parser.print_help()
