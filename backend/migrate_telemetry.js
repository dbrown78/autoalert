const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telemetry_logs (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL,
      vehicle_id    INTEGER,
      logged_at     TIMESTAMPTZ DEFAULT NOW(),
      coolant_temp  NUMERIC,
      rpm           NUMERIC,
      voltage       NUMERIC,
      o2_sensor     NUMERIC,
      fuel_trim     NUMERIC,
      engine_load   NUMERIC,
      intake_temp   NUMERIC,
      raw_data      JSONB
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_user_vehicle 
      ON telemetry_logs(user_id, vehicle_id, logged_at DESC);
  `);
  console.log('✅ telemetry_logs table created');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
