const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    ALTER TABLE telemetry_logs
      ADD COLUMN IF NOT EXISTS oil_pressure      NUMERIC,
      ADD COLUMN IF NOT EXISTS fuel_pressure     NUMERIC,
      ADD COLUMN IF NOT EXISTS coolant_pressure  NUMERIC;
  `);

  console.log('✅ telemetry_logs extended with oil_pressure, fuel_pressure, coolant_pressure');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
