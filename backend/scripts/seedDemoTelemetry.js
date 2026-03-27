'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');

// ── EDIT THESE BEFORE RUNNING ──────────────────────────────────────────────
const VEHICLE_ID = 1; // 2020 Toyota Camry
const USER_ID    = 1;
// ───────────────────────────────────────────────────────────────────────────

// 50 rows of realistic-but-slightly-degraded sensor data.
// Values designed to trigger:
//   - coolant_overheat_warning  (avg coolant_temp > 95)
//   - voltage_low               (avg voltage < 12.4)
// All other systems nominal.
function makeRow(i) {
  const offset = i * 30; // 30-second intervals going back in time
  return {
    coolant_temp:  96 + Math.random() * 3,     // 96–99 °C  → triggers warning
    rpm:           850 + Math.random() * 200,
    engine_load:   45 + Math.random() * 20,
    voltage:       12.1 + Math.random() * 0.2, // 12.1–12.3 V → triggers voltage_low
    oil_pressure:  2.5 + Math.random() * 0.5,  // normal
    fuel_trim:     2   + Math.random() * 4,    // normal
    intake_temp:   35  + Math.random() * 5,
    logged_at: new Date(Date.now() - offset * 1000).toISOString(),
  };
}

async function seed() {
  console.log(`Seeding 50 telemetry rows for vehicle ${VEHICLE_ID} / user ${USER_ID}...`);
  for (let i = 0; i < 50; i++) {
    const r = makeRow(i);
    await pool.query(
      `INSERT INTO telemetry_logs
         (user_id, vehicle_id, coolant_temp, rpm, engine_load, voltage,
          oil_pressure, fuel_trim, intake_temp, logged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [USER_ID, VEHICLE_ID,
       r.coolant_temp, r.rpm, r.engine_load, r.voltage,
       r.oil_pressure, r.fuel_trim, r.intake_temp,
       r.logged_at]
    );
  }
  console.log('Done. Rule-based alerts should now fire for coolant + battery.');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
