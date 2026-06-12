require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const pool = require('./config/db');

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash   TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      used        BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prc_user ON password_reset_codes(user_id)
  `);
  console.log('✔ password_reset_codes table ready');
  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
