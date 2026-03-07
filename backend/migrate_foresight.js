const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS foresight_alerts (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL,
      vehicle_id   INTEGER NOT NULL,
      sensor       TEXT NOT NULL,
      label        TEXT NOT NULL,
      severity     TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
      detail       TEXT,
      reading      NUMERIC,
      resolved     BOOLEAN NOT NULL DEFAULT FALSE,
      resolved_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Enforce one open alert per sensor per vehicle per user.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_foresight_open_alert
      ON foresight_alerts(user_id, vehicle_id, sensor)
      WHERE resolved = FALSE;

    -- Fast lookup of active alerts by vehicle.
    CREATE INDEX IF NOT EXISTS idx_foresight_vehicle
      ON foresight_alerts(user_id, vehicle_id, resolved, created_at DESC);
  `);
  console.log('✅ foresight_alerts table created');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
