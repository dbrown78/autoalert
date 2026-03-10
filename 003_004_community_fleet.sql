-- ─────────────────────────────────────────────────────────────────────────────
-- 003_create_community_baselines.sql
-- Anonymized aggregate sensor stats per make/model/year (AWS fleet_statistics equivalent)
-- Powers "your coolant temp runs 12% hotter than other 2019 Civics" Foresight output
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS community_baselines (
  id              BIGSERIAL PRIMARY KEY,
  make            VARCHAR(50)  NOT NULL,
  model           VARCHAR(50)  NOT NULL,
  year            SMALLINT     NOT NULL,
  sensor_type     VARCHAR(50)  NOT NULL,

  -- Rolling aggregate stats (updated nightly by baseline job)
  mean_value      NUMERIC(10, 4) NOT NULL,
  std_value       NUMERIC(10, 4) NOT NULL,
  p10_value       NUMERIC(10, 4),   -- 10th percentile
  p90_value       NUMERIC(10, 4),   -- 90th percentile
  sample_count    INTEGER NOT NULL DEFAULT 0,  -- number of vehicles contributing

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one row per make/model/year/sensor
CREATE UNIQUE INDEX IF NOT EXISTS idx_baselines_vehicle_sensor
  ON community_baselines (make, model, year, sensor_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 004_create_fleet_subscriptions.sql
-- Fleet tier — enables multi-vehicle management + stratified ML training
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_subscriptions (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fleet_name      VARCHAR(100) NOT NULL,
  max_vehicles    INTEGER NOT NULL DEFAULT 25,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id              BIGSERIAL PRIMARY KEY,
  fleet_id        INTEGER NOT NULL REFERENCES fleet_subscriptions(id) ON DELETE CASCADE,
  vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fleet_id, vehicle_id)
);

-- Add fleet + premium flags to users if not present
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_fleet       BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON TABLE community_baselines    IS 'Anonymized aggregate sensor stats per make/model/year. Powers Foresight community comparison.';
COMMENT ON TABLE fleet_subscriptions    IS 'Fleet tier subscription metadata.';
COMMENT ON TABLE fleet_vehicles         IS 'Vehicles belonging to a fleet subscription.';
