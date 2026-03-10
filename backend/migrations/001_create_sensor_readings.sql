-- 001_create_sensor_readings.sql
-- Phase 3: Sensor streaming buffer table
--
-- Retention policy: 90 days
-- In production, run a nightly cron or pg_cron job:
--   DELETE FROM sensor_readings WHERE recorded_at < NOW() - INTERVAL '90 days';

CREATE TABLE IF NOT EXISTS sensor_readings (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  vehicle_id  INTEGER      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  sensor_type TEXT         NOT NULL,
  value       NUMERIC      NOT NULL,
  recorded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast time-window queries per vehicle + sensor (primary query path)
CREATE INDEX IF NOT EXISTS idx_sensor_readings_vehicle_sensor_time
  ON sensor_readings (vehicle_id, sensor_type, recorded_at DESC);

-- Fast queries per user + vehicle (for auth-scoped queries)
CREATE INDEX IF NOT EXISTS idx_sensor_readings_user_vehicle_time
  ON sensor_readings (user_id, vehicle_id, recorded_at DESC);
