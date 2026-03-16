const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    ALTER TABLE vehicles
      ADD COLUMN IF NOT EXISTS nickname   TEXT,
      ADD COLUMN IF NOT EXISTS vin        CHAR(17),
      ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_vin
      ON vehicles(vin) WHERE vin IS NOT NULL;
  `);
  console.log('✅ vehicles: nickname, vin, is_active, updated_at added');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
