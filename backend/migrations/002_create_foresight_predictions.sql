-- 002_create_foresight_predictions.sql
-- Phase 4: ML Foresight prediction history + premium gate

-- Premium flag on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;

-- Prediction history table
CREATE TABLE IF NOT EXISTS foresight_predictions (
  id                       BIGSERIAL    PRIMARY KEY,
  user_id                  INTEGER      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  vehicle_id               INTEGER      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  predicted_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  maintenance_probability  NUMERIC(5,4) NOT NULL,
  maintenance_urgency      TEXT         NOT NULL,  -- 'ok' | 'watch' | 'soon' | 'urgent'
  estimated_service_date   DATE,
  days_until_service       INTEGER,
  part_scores              JSONB        NOT NULL DEFAULT '{}',
  data_quality             TEXT         NOT NULL DEFAULT 'good',
  source                   TEXT         NOT NULL DEFAULT 'live'
);

CREATE INDEX IF NOT EXISTS idx_foresight_predictions_vehicle_time
  ON foresight_predictions (vehicle_id, predicted_at DESC);

-- Set test user (id=1) as premium for development
-- Comment this out before going to production
UPDATE users SET is_premium = TRUE WHERE id = 1;
