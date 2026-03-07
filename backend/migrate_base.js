const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    -- Users
    -- Columns inferred from auth.js: INSERT (name, email, password), SELECT (id, name, email)
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      password   TEXT NOT NULL
    );

    -- Vehicles
    -- Columns inferred from vehicles.js: INSERT (user_id, year, make, model, trim, mileage),
    -- SELECT *, ORDER BY created_at DESC
    CREATE TABLE IF NOT EXISTS vehicles (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year       INTEGER,
      make       TEXT,
      model      TEXT,
      trim       TEXT,
      mileage    INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_vehicles_user
      ON vehicles(user_id, created_at DESC);

    -- Scan history
    -- Columns inferred from scans.js: INSERT (user_id, vehicle_id, dtc_code),
    -- SELECT (id, dtc_code, scanned_at, vehicle_id), JOIN dtc_codes ON code, LEFT JOIN vehicles ON id
    CREATE TABLE IF NOT EXISTS scan_history (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
      dtc_code   TEXT NOT NULL,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_scan_history_user
      ON scan_history(user_id, scanned_at DESC);
  `);

  console.log('✅ users, vehicles, scan_history tables created');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
