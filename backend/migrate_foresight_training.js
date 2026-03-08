const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    -- Training data table for Foresight Phase 4 (ML model development).
    -- Seeded from engine_data.csv (iDharshan/ML-Based-Vehicle-Predictive-Maintenance-System,
    -- 19,535 rows). Intentionally kept separate from foresight_alerts so the
    -- live alert schema can evolve independently of the training corpus.
    --
    -- Column provenance (original CSV → ODIN field):
    --   Engine rpm          → rpm             (range in dataset: 61–2239 RPM)
    --   Lub oil pressure    → oil_pressure     (range: 0.003–7.27, unit: bar)
    --   Fuel pressure       → fuel_pressure    (range: 0.003–21.1, unit: bar)
    --   Coolant pressure    → coolant_pressure (range: 0.003–7.48, unit: bar)
    --   lub oil temp        → oil_temp         (range: 71.3–89.6 °C)
    --   Coolant temp        → coolant_temp     (range: 61.7–195.5 °C)
    --   Engine Condition    → failure_label    (0 = healthy, 1 = needs maintenance)
    --
    -- ODIN OBD2 fields NOT present in this dataset (will need supplemental data
    -- or synthetic augmentation for Phase 4):
    --   battery_voltage, fuel_trim, throttle_position, engine_load,
    --   o2_sensor, intake_temp
    CREATE TABLE IF NOT EXISTS foresight_training_data (
      id                SERIAL PRIMARY KEY,
      source            TEXT NOT NULL DEFAULT 'engine_data_v1',
      rpm               NUMERIC(8,4),
      oil_pressure      NUMERIC(8,6),
      fuel_pressure     NUMERIC(8,6),
      coolant_pressure  NUMERIC(8,6),
      oil_temp          NUMERIC(8,4),
      coolant_temp      NUMERIC(8,4),
      failure_label     SMALLINT NOT NULL CHECK (failure_label IN (0, 1)),
      ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_training_failure
      ON foresight_training_data(failure_label);

    CREATE INDEX IF NOT EXISTS idx_training_source
      ON foresight_training_data(source);
  `);

  console.log('✅ foresight_training_data table created');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
