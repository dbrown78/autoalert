require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scan_history (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
      dtc_code    VARCHAR(10) NOT NULL REFERENCES dtc_codes(code),
      scanned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_scan_history_user_time
      ON scan_history (user_id, scanned_at DESC)
  `);
  console.log('scan_history table and index ready.');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
