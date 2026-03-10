-- Phase 3: Continuous Sensor Streaming Buffer
-- Migration: 001_create_sensor_readings.sql

CREATE TABLE IF NOT EXISTS sensor_readings (
  id              BIGSERIAL PRIMARY KEY,
  vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  sensor_type     VARCHAR(50) NOT NULL,
  value           NUMERIC(10, 4) NOT NULL,
  unit            VARCHAR(20) NOT NULL,
  quality         SMALLINT DEFAULT 1,  -- 0=bad, 1=ok, 2=good (for preprocessing later)
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index for fast trend queries per vehicle + sensor + time window
CREATE INDEX IF NOT EXISTS idx_sensor_readings_vehicle_sensor_time
  ON sensor_readings (vehicle_id, sensor_type, recorded_at DESC);

-- Index for time-based cleanup jobs
CREATE INDEX IF NOT EXISTS idx_sensor_readings_recorded_at
  ON sensor_readings (recorded_at DESC);

-- Auto-purge old data: keep 90 days by default (adjust as needed)
-- This can be run as a cron job or pg_cron task
-- DELETE FROM sensor_readings WHERE recorded_at < NOW() - INTERVAL '90 days';

COMMENT ON TABLE sensor_readings IS 'Persistent OBD2 sensor stream buffer. Powers Foresight (v1.1) and ML training (v1.1 Phase 4).';
COMMENT ON COLUMN sensor_readings.quality IS '0=dropped/invalid, 1=normal, 2=verified clean';
