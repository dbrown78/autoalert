"""
core/schema.py

All SQL DDL for the ODIN sim schema.
Uses CREATE TABLE IF NOT EXISTS throughout — fully idempotent.

Tables:
  sensor_readings      — shared with real app data, distinguished by source col
  sim_vehicles         — registry of simulated vehicles
  sim_failure_events   — one row per injected failure per vehicle
  sim_day_labels       — per-vehicle per-day ML training labels

Indexes are created separately from tables so the migration can report
each step independently.
"""

# ── Table definitions ─────────────────────────────────────────────────────────

CREATE_SENSOR_READINGS = """
CREATE TABLE IF NOT EXISTS sensor_readings (
    id                  BIGSERIAL PRIMARY KEY,
    vehicle_id          VARCHAR(64) NOT NULL,
    timestamp           TIMESTAMPTZ NOT NULL,
    day                 INTEGER,
    tick                INTEGER,
    sensor_name         VARCHAR(64) NOT NULL,
    value               DOUBLE PRECISION NOT NULL,
    unit                VARCHAR(16),
    is_healthy          BOOLEAN DEFAULT TRUE,
    degradation_factor  DOUBLE PRECISION DEFAULT 0.0,
    source              VARCHAR(32) DEFAULT 'real',
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
"""

CREATE_SIM_VEHICLES = """
CREATE TABLE IF NOT EXISTS sim_vehicles (
    vehicle_id          VARCHAR(64) PRIMARY KEY,
    make_model          VARCHAR(128),
    year                INTEGER,
    mileage_km          INTEGER,
    driving_profile     VARCHAR(32),
    base_health         DOUBLE PRECISION,
    archetype           VARCHAR(64),
    seed                INTEGER,
    is_demo             BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
"""

CREATE_SIM_FAILURE_EVENTS = """
CREATE TABLE IF NOT EXISTS sim_failure_events (
    id                          BIGSERIAL PRIMARY KEY,
    vehicle_id                  VARCHAR(64) NOT NULL,
    failure_mode                VARCHAR(64),
    dtc_code                    VARCHAR(16),
    dtc_description             TEXT,
    failure_start_day           INTEGER,
    dtc_fire_day                INTEGER,
    dtc_fired                   BOOLEAN DEFAULT FALSE,
    total_sim_days              INTEGER,
    degradation_factor_at_fire  DOUBLE PRECISION,
    repair_cost_oem_min         INTEGER,
    repair_cost_oem_max         INTEGER,
    repair_cost_am_min          INTEGER,
    repair_cost_am_max          INTEGER,
    curve_shape                 VARCHAR(16),
    created_at                  TIMESTAMPTZ DEFAULT NOW()
);
"""

CREATE_SIM_DAY_LABELS = """
CREATE TABLE IF NOT EXISTS sim_day_labels (
    id                  BIGSERIAL PRIMARY KEY,
    vehicle_id          VARCHAR(64) NOT NULL,
    day                 INTEGER NOT NULL,
    failure_mode        VARCHAR(64),
    dtc_code            VARCHAR(16),
    degradation_factor  DOUBLE PRECISION DEFAULT 0.0,
    days_to_dtc         INTEGER,
    label_binary        SMALLINT DEFAULT 0,
    label_severity      VARCHAR(16) DEFAULT 'healthy',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (vehicle_id, day)
);
"""

# ── Index definitions ─────────────────────────────────────────────────────────

INDEXES = [
    # sensor_readings — primary access patterns
    ("idx_sr_vehicle_time",
     "CREATE INDEX IF NOT EXISTS idx_sr_vehicle_time "
     "ON sensor_readings (vehicle_id, timestamp DESC);"),

    ("idx_sr_source",
     "CREATE INDEX IF NOT EXISTS idx_sr_source "
     "ON sensor_readings (source);"),

    ("idx_sr_sensor_vehicle",
     "CREATE INDEX IF NOT EXISTS idx_sr_sensor_vehicle "
     "ON sensor_readings (sensor_name, vehicle_id);"),

    ("idx_sr_day",
     "CREATE INDEX IF NOT EXISTS idx_sr_day "
     "ON sensor_readings (vehicle_id, day);"),

    # sim_day_labels — ML trainer access pattern
    ("idx_sdl_vehicle_day",
     "CREATE INDEX IF NOT EXISTS idx_sdl_vehicle_day "
     "ON sim_day_labels (vehicle_id, day);"),

    ("idx_sdl_label_binary",
     "CREATE INDEX IF NOT EXISTS idx_sdl_label_binary "
     "ON sim_day_labels (label_binary);"),

    # sim_failure_events
    ("idx_sfe_vehicle",
     "CREATE INDEX IF NOT EXISTS idx_sfe_vehicle "
     "ON sim_failure_events (vehicle_id);"),
]

# Ordered migration steps
MIGRATION_STEPS = [
    ("sensor_readings table",    CREATE_SENSOR_READINGS),
    ("sim_vehicles table",       CREATE_SIM_VEHICLES),
    ("sim_failure_events table", CREATE_SIM_FAILURE_EVENTS),
    ("sim_day_labels table",     CREATE_SIM_DAY_LABELS),
] + [(name, sql) for name, sql in INDEXES]


# ── Verification queries ──────────────────────────────────────────────────────

TABLE_NAMES = [
    "sensor_readings",
    "sim_vehicles",
    "sim_failure_events",
    "sim_day_labels",
]

VERIFY_QUERIES = {
    name: f"SELECT COUNT(*) FROM {name}"
    for name in TABLE_NAMES
}

VERIFY_SIM_ONLY = {
    "sensor_readings (sim)":
        "SELECT COUNT(*) FROM sensor_readings WHERE source LIKE 'sim%'",
    "sensor_readings (real)":
        "SELECT COUNT(*) FROM sensor_readings WHERE source = 'real'",
}


# ── Clear queries (sim data only — never touches real data) ───────────────────

CLEAR_QUERIES = [
    "DELETE FROM sim_day_labels",
    "DELETE FROM sim_failure_events",
    "DELETE FROM sensor_readings WHERE source LIKE 'sim%'",
    "DELETE FROM sim_vehicles",
]

CLEAR_VEHICLE_QUERIES = [
    ("sim_day_labels",    "DELETE FROM sim_day_labels WHERE vehicle_id = %s"),
    ("sim_failure_events","DELETE FROM sim_failure_events WHERE vehicle_id = %s"),
    ("sensor_readings",   "DELETE FROM sensor_readings WHERE vehicle_id = %s AND source LIKE 'sim%'"),
    ("sim_vehicles",      "DELETE FROM sim_vehicles WHERE vehicle_id = %s"),
]
