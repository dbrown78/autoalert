const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    -- One row per (user, device). A user may have multiple devices.
    -- token is the Expo push token string, globally unique per installation.
    -- Upsert on token so re-registration is idempotent and user_id updates
    -- when the same device logs in as a different account.
    CREATE TABLE IF NOT EXISTS device_push_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      platform   TEXT CHECK (platform IN ('ios', 'android', 'web')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_push_tokens_user
      ON device_push_tokens(user_id);
  `);

  console.log('✅ device_push_tokens table created');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
