require('dotenv').config();
const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    ALTER TABLE dtc_codes
      ADD COLUMN IF NOT EXISTS oem_cost_min         INTEGER,
      ADD COLUMN IF NOT EXISTS oem_cost_max         INTEGER,
      ADD COLUMN IF NOT EXISTS aftermarket_cost_min INTEGER,
      ADD COLUMN IF NOT EXISTS aftermarket_cost_max INTEGER,
      ADD COLUMN IF NOT EXISTS labor_hours_min      NUMERIC(4,1),
      ADD COLUMN IF NOT EXISTS labor_hours_max      NUMERIC(4,1),
      ADD COLUMN IF NOT EXISTS diy_difficulty       VARCHAR(10)
        CHECK (diy_difficulty IN ('easy', 'moderate', 'hard'))
  `);
  console.log('Migration complete — cost columns added to dtc_codes.');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
