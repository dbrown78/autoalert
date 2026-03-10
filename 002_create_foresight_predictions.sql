-- Phase 4: ML Foresight Predictions
-- Migration: 002_create_foresight_predictions.sql

CREATE TABLE IF NOT EXISTS foresight_predictions (
  id                  BIGSERIAL PRIMARY KEY,
  vehicle_id          INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  predicted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Overall maintenance signal
  maintenance_probability  NUMERIC(5, 4) NOT NULL,  -- 0.0000 - 1.0000
  maintenance_urgency      VARCHAR(20) NOT NULL,     -- 'normal', 'watch', 'soon', 'critical'
  estimated_service_date   DATE,                     -- NULL if urgency is 'normal'
  days_until_service       INTEGER,                  -- NULL if urgency is 'normal'

  -- Per-part failure probabilities (JSONB for flexible schema)
  -- Format: { "coolant": 0.74, "battery": 0.31, "oil": 0.12, ... }
  part_scores         JSONB NOT NULL DEFAULT '{}',

  -- Feature snapshot used for this prediction (for audit + retraining)
  feature_snapshot    JSONB NOT NULL DEFAULT '{}',

  -- Premium gate flag
  is_premium          BOOLEAN NOT NULL DEFAULT TRUE
);

-- Fast lookup of latest prediction per vehicle
CREATE INDEX IF NOT EXISTS idx_foresight_vehicle_time
  ON foresight_predictions (vehicle_id, predicted_at DESC);

COMMENT ON TABLE foresight_predictions IS 'ML Foresight output per vehicle. Premium tier feature (v1.1 Phase 4).';
COMMENT ON COLUMN foresight_predictions.part_scores IS 'Per-part GBM failure probability scores 0.0-1.0';
COMMENT ON COLUMN foresight_predictions.feature_snapshot IS 'Rolling sensor features used for this prediction run';
