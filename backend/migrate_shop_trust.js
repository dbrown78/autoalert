const pool = require('./config/db');

async function migrate() {
  await pool.query(`
    -- ODIN benchmark costs per DTC code.
    -- Seeded from dtc_codes; fair_cost_estimate = aftermarket midpoint + labor midpoint * $120/hr.
    CREATE TABLE IF NOT EXISTS repair_cost_benchmarks (
      dtc_code              TEXT PRIMARY KEY,
      oem_cost_min          INTEGER NOT NULL,
      oem_cost_max          INTEGER NOT NULL,
      aftermarket_cost_min  INTEGER NOT NULL,
      aftermarket_cost_max  INTEGER NOT NULL,
      labor_hours_min       NUMERIC(4,1) NOT NULL,
      labor_hours_max       NUMERIC(4,1) NOT NULL,
      fair_cost_estimate    NUMERIC(8,2) NOT NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- User-submitted repair outcomes for a shop.
    -- shop_id matches the Google Places ID returned by /api/mechanics.
    CREATE TABLE IF NOT EXISTS shop_outcomes (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER NOT NULL,
      shop_id          TEXT NOT NULL,
      shop_name        TEXT NOT NULL,
      dtc_code         TEXT NOT NULL,
      quoted_cost      NUMERIC(8,2),
      final_cost       NUMERIC(8,2),
      fix_success      BOOLEAN NOT NULL,
      upsells_reported BOOLEAN NOT NULL DEFAULT FALSE,
      upsell_detail    TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_shop_outcomes_shop
      ON shop_outcomes(shop_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_shop_outcomes_user
      ON shop_outcomes(user_id, created_at DESC);
  `);

  console.log('✅ repair_cost_benchmarks and shop_outcomes tables created');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
