const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code VARCHAR(6);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMP;
  `);
  console.log('[migrate_email_verification] Done.');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
