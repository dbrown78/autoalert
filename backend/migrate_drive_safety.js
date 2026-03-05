require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    ALTER TABLE dtc_codes
      ADD COLUMN IF NOT EXISTS drive_safety        VARCHAR(10)
        CHECK (drive_safety IN ('yes', 'caution', 'no')),
      ADD COLUMN IF NOT EXISTS drive_safety_reason TEXT
  `);
  console.log('Migration complete — drive_safety columns added to dtc_codes.');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
