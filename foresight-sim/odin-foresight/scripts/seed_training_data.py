"""
scripts/seed_training_data.py

Fast synthetic data seeder for odin-foresight ML training.
Bypasses the full telemetry simulation (which writes 768k rows/day) and
instead directly inserts pre-aggregated sensor stats into the DB.

Generates 50 vehicles × 90 days = 4,500 daily label rows and
50 × 90 × 12 sensors × 10 readings = 54,000,000 / 100 = 540,000 rows total
(actually just 54,000 daily aggregated rows — 10 readings per sensor per day).

Runtime: <30 seconds (vs 90 minutes for the full simulation).

Usage:
    python scripts/seed_training_data.py [--vehicles 50] [--days 90] [--seed 42]
    python scripts/seed_training_data.py --clear   # Clear sim data only
"""

import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import numpy as np
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from datetime import datetime, timezone, timedelta

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

SENSORS = [
    ("rpm",               500,  8000,  200),
    ("vehicle_speed",     0,    200,   5),
    ("coolant_temp",      70,   110,   3),
    ("intake_air_temp",   15,   60,    2),
    ("maf_rate",          2,    30,    1),
    ("throttle_position", 5,    100,   5),
    ("short_fuel_trim",   -10,  10,    2),
    ("long_fuel_trim",    -15,  15,    1.5),
    ("o2_voltage_b1s1",   0.1,  0.9,   0.05),
    ("o2_voltage_b1s2",   0.1,  0.9,   0.05),
    ("catalyst_temp",     400,  900,   20),
    ("battery_voltage",   12,   15,    0.3),
]

FAILURE_MODES = {
    "o2_sensor": {
        "sensors": ["o2_voltage_b1s1", "short_fuel_trim", "long_fuel_trim"],
        "dtc": "P0136",
        "description": "O2 Sensor Circuit Malfunction (Bank 1, Sensor 2)",
    },
    "catalytic_converter": {
        "sensors": ["catalyst_temp", "o2_voltage_b1s2"],
        "dtc": "P0420",
        "description": "Catalyst System Efficiency Below Threshold",
    },
    "maf_sensor": {
        "sensors": ["maf_rate", "rpm", "short_fuel_trim"],
        "dtc": "P0101",
        "description": "MAF Sensor Circuit Range/Performance",
    },
    "battery_alternator": {
        "sensors": ["battery_voltage"],
        "dtc": "P0562",
        "description": "System Voltage Low",
    },
}

ARCHETYPES = [
    "sedan_low_mileage",
    "sedan_high_mileage",
    "suv_family",
    "truck_work",
    "economy_beater",
]


def _get_conn():
    return psycopg2.connect(DATABASE_URL)


def clear_sim_data(conn):
    print("Clearing existing sim data...")
    with conn.cursor() as cur:
        cur.execute("DELETE FROM sim_day_labels")
        cur.execute("DELETE FROM sim_failure_events")
        cur.execute("DELETE FROM sim_sensor_readings")
        cur.execute("DELETE FROM sim_vehicles WHERE is_demo = FALSE")
    conn.commit()
    print("  Done")


def seed_vehicle(conn, vehicle_id: str, archetype: str, failure_mode: str | None,
                 n_days: int, rng: np.random.Generator, is_demo: bool = False):
    mileage = int(rng.integers(5000, 250000))
    year = int(rng.integers(2010, 2025))
    base_health = float(rng.uniform(0.5, 1.0))

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO sim_vehicles
                (vehicle_id, make_model, year, mileage_km, driving_profile,
                 base_health, archetype, seed, is_demo)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (vehicle_id) DO UPDATE
              SET make_model = EXCLUDED.make_model,
                  archetype  = EXCLUDED.archetype,
                  is_demo    = EXCLUDED.is_demo
        """, (
            vehicle_id, f"Sim Vehicle {archetype}", year, mileage,
            archetype, base_health, archetype, int(rng.integers(0, 99999)),
            is_demo,
        ))

    failure_start = int(n_days * 0.3) if failure_mode else None
    mode_info = FAILURE_MODES.get(failure_mode) if failure_mode else None
    dtc_fire_day = int(n_days * 0.8) if failure_mode else None

    sensor_rows = []
    label_rows = []
    base_time = datetime(2025, 1, 1, 7, 0, 0, tzinfo=timezone.utc)

    for day in range(n_days):
        degradation_factor = 0.0
        if failure_mode and failure_start and day >= failure_start:
            progress = (day - failure_start) / max(1, dtc_fire_day - failure_start)
            degradation_factor = float(min(1.0, progress ** 1.5))

        days_to_dtc = (dtc_fire_day - day) if (failure_mode and dtc_fire_day and day <= dtc_fire_day) else None
        label_binary = 1 if (failure_mode and days_to_dtc is not None and days_to_dtc <= 14) else 0
        if label_binary == 1:
            severity = "imminent" if days_to_dtc <= 3 else ("late" if days_to_dtc <= 7 else "early")
        else:
            severity = "healthy"

        label_rows.append((
            vehicle_id, day,
            failure_mode, mode_info["dtc"] if mode_info else None,
            degradation_factor, days_to_dtc, label_binary, severity,
        ))

        ts = base_time + timedelta(days=day)
        for sensor_name, s_min, s_max, s_noise in SENSORS:
            center = (s_min + s_max) / 2
            # Inject degradation into affected sensors
            affected = mode_info and sensor_name in mode_info["sensors"]
            if affected and degradation_factor > 0:
                # Shift center toward extreme
                center = center + (s_max - center) * degradation_factor * 0.6

            # Generate 10 synthetic readings per sensor per day
            vals = rng.normal(center, s_noise, 10)
            vals = np.clip(vals, s_min, s_max)

            sensor_rows.append((
                vehicle_id, ts, day, 0,
                sensor_name,
                float(np.mean(vals)),  # value = mean
                None,                  # unit
                not bool(affected and degradation_factor > 0.1),  # is_healthy
                float(degradation_factor),
                "sim",
            ))
            # Also insert the individual readings for STDDEV computation
            for i, v in enumerate(vals[1:5]):  # 4 more readings for variance
                sensor_rows.append((
                    vehicle_id, ts + timedelta(seconds=i * 15), day, i + 1,
                    sensor_name, float(v), None,
                    not bool(affected and degradation_factor > 0.1),
                    float(degradation_factor), "sim",
                ))

    # Bulk insert sensors
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO sim_sensor_readings
               (vehicle_id, timestamp, day, tick, sensor_name, value, unit,
                is_healthy, degradation_factor, source)
               VALUES %s ON CONFLICT DO NOTHING""",
            sensor_rows,
            page_size=5000,
        )

    # Bulk insert labels
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO sim_day_labels
               (vehicle_id, day, failure_mode, dtc_code, degradation_factor,
                days_to_dtc, label_binary, label_severity)
               VALUES %s ON CONFLICT (vehicle_id, day) DO NOTHING""",
            label_rows,
            page_size=5000,
        )

    # Insert failure event
    if failure_mode and mode_info:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO sim_failure_events
                    (vehicle_id, failure_mode, dtc_code, dtc_description,
                     failure_start_day, dtc_fire_day, dtc_fired, total_sim_days,
                     degradation_factor_at_fire, curve_shape)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                vehicle_id, failure_mode, mode_info["dtc"],
                mode_info["description"], failure_start,
                dtc_fire_day, True, n_days, 0.8, "sigmoid",
            ))

    conn.commit()
    return len(sensor_rows), len(label_rows)


def main():
    parser = argparse.ArgumentParser(description="Fast ODIN training data seeder")
    parser.add_argument("--vehicles", type=int, default=50, help="Fleet size (default 50)")
    parser.add_argument("--days",     type=int, default=90, help="Days per vehicle (default 90)")
    parser.add_argument("--seed",     type=int, default=42)
    parser.add_argument("--clear",    action="store_true", help="Clear sim data only")
    parser.add_argument("--demo-only",action="store_true", help="Generate only 5 demo vehicles")
    args = parser.parse_args()

    conn = _get_conn()
    rng = np.random.default_rng(args.seed)

    if args.clear:
        clear_sim_data(conn)
        conn.close()
        print("Cleared.")
        return

    if not args.demo_only:
        clear_sim_data(conn)

    failure_keys = list(FAILURE_MODES.keys())
    failure_rate = 0.6
    n_vehicles = args.vehicles
    n_days = args.days

    if args.demo_only:
        jobs = [
            ("DEMO-001", "sedan_high_mileage",  "o2_sensor"),
            ("DEMO-002", "truck_work",           "catalytic_converter"),
            ("DEMO-003", "economy_beater",       "maf_sensor"),
            ("DEMO-004", "suv_family",           "battery_alternator"),
            ("DEMO-005", "sedan_low_mileage",    None),
        ]
        print(f"\nSeeding 5 demo vehicles × {n_days} days...")
        for vid, arch, fmode in jobs:
            sr, lr = seed_vehicle(conn, vid, arch, fmode, n_days, rng, is_demo=True)
            status = fmode or "healthy"
            print(f"  {vid}  {arch:<22}  {status:<25}  "
                  f"{sr:>6} sensor rows  {lr:>3} label rows")
    else:
        print(f"\nSeeding {n_vehicles} vehicles × {n_days} days...")
        # Include 5 demo vehicles
        demo_jobs = [
            ("DEMO-001", "sedan_high_mileage",  "o2_sensor",            True),
            ("DEMO-002", "truck_work",           "catalytic_converter",  True),
            ("DEMO-003", "economy_beater",       "maf_sensor",           True),
            ("DEMO-004", "suv_family",           "battery_alternator",   True),
            ("DEMO-005", "sedan_low_mileage",    None,                   True),
        ]
        for vid, arch, fmode, is_demo in demo_jobs:
            sr, lr = seed_vehicle(conn, vid, arch, fmode, n_days, rng, is_demo=is_demo)
            print(f"  {vid}  ✓  {sr:>6} sensor rows  {lr:>3} labels")

        for i in range(n_vehicles - 5):
            vid = f"SIM-{i+1:04d}"
            arch = ARCHETYPES[i % len(ARCHETYPES)]
            fmode = failure_keys[i % len(failure_keys)] if rng.random() < failure_rate else None
            sr, lr = seed_vehicle(conn, vid, arch, fmode, n_days, rng)
            if i % 10 == 0:
                print(f"  {vid}  ✓  {sr:>6} sensor rows  {lr:>3} labels  "
                      f"({fmode or 'healthy'})")

    conn.close()

    print(f"\nDone. Verifying row counts...")
    conn2 = _get_conn()
    with conn2.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM sim_sensor_readings")
        sr_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM sim_day_labels")
        dl_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT vehicle_id) FROM sim_day_labels")
        veh_count = cur.fetchone()[0]
    conn2.close()

    print(f"  sim_sensor_readings: {sr_count:,}")
    print(f"  sim_day_labels:      {dl_count:,}")
    print(f"  vehicles:            {veh_count}")
    print("\nReady for training. Run: python scripts/train.py\n")


if __name__ == "__main__":
    main()
