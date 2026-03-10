const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  console.log('✅ is_premium column added to users');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
