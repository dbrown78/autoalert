require('dotenv').config();
const pool = require('./config/db');

// Cost data sourced directly from seed_dtc.js.
// fair_cost_estimate = aftermarket midpoint + (labor midpoint * $120/hr industry rate).
const LABOR_RATE = 120;

const benchmarks = [
  { dtc_code: 'P0300', oem_cost_min: 100,  oem_cost_max: 500,  aftermarket_cost_min: 40,  aftermarket_cost_max: 250, labor_hours_min: 1.0, labor_hours_max: 2.5 },
  { dtc_code: 'P0301', oem_cost_min: 30,   oem_cost_max: 350,  aftermarket_cost_min: 15,  aftermarket_cost_max: 180, labor_hours_min: 0.5, labor_hours_max: 1.5 },
  { dtc_code: 'P0420', oem_cost_min: 800,  oem_cost_max: 1500, aftermarket_cost_min: 200, aftermarket_cost_max: 600, labor_hours_min: 1.5, labor_hours_max: 3.0 },
  { dtc_code: 'P0430', oem_cost_min: 800,  oem_cost_max: 1500, aftermarket_cost_min: 200, aftermarket_cost_max: 600, labor_hours_min: 1.5, labor_hours_max: 3.0 },
  { dtc_code: 'P0171', oem_cost_min: 100,  oem_cost_max: 800,  aftermarket_cost_min: 30,  aftermarket_cost_max: 400, labor_hours_min: 1.0, labor_hours_max: 3.0 },
  { dtc_code: 'P0174', oem_cost_min: 100,  oem_cost_max: 800,  aftermarket_cost_min: 30,  aftermarket_cost_max: 400, labor_hours_min: 1.0, labor_hours_max: 3.0 },
  { dtc_code: 'P0128', oem_cost_min: 100,  oem_cost_max: 350,  aftermarket_cost_min: 30,  aftermarket_cost_max: 150, labor_hours_min: 0.5, labor_hours_max: 1.5 },
  { dtc_code: 'P0442', oem_cost_min: 20,   oem_cost_max: 350,  aftermarket_cost_min: 10,  aftermarket_cost_max: 150, labor_hours_min: 0.5, labor_hours_max: 2.0 },
  { dtc_code: 'P0455', oem_cost_min: 20,   oem_cost_max: 500,  aftermarket_cost_min: 10,  aftermarket_cost_max: 250, labor_hours_min: 0.5, labor_hours_max: 2.0 },
  { dtc_code: 'P0446', oem_cost_min: 80,   oem_cost_max: 250,  aftermarket_cost_min: 30,  aftermarket_cost_max: 100, labor_hours_min: 0.5, labor_hours_max: 1.5 },
  { dtc_code: 'P0401', oem_cost_min: 80,   oem_cost_max: 500,  aftermarket_cost_min: 30,  aftermarket_cost_max: 200, labor_hours_min: 1.0, labor_hours_max: 2.5 },
  { dtc_code: 'P0011', oem_cost_min: 500,  oem_cost_max: 1500, aftermarket_cost_min: 200, aftermarket_cost_max: 700, labor_hours_min: 3.0, labor_hours_max: 8.0 },
  { dtc_code: 'P0340', oem_cost_min: 80,   oem_cost_max: 300,  aftermarket_cost_min: 30,  aftermarket_cost_max: 100, labor_hours_min: 0.5, labor_hours_max: 1.5 },
  { dtc_code: 'P0507', oem_cost_min: 80,   oem_cost_max: 300,  aftermarket_cost_min: 30,  aftermarket_cost_max: 120, labor_hours_min: 0.5, labor_hours_max: 1.5 },
  { dtc_code: 'P0562', oem_cost_min: 150,  oem_cost_max: 700,  aftermarket_cost_min: 80,  aftermarket_cost_max: 350, labor_hours_min: 0.5, labor_hours_max: 2.0 },
  { dtc_code: 'P0500', oem_cost_min: 80,   oem_cost_max: 250,  aftermarket_cost_min: 30,  aftermarket_cost_max: 100, labor_hours_min: 0.5, labor_hours_max: 2.0 },
  { dtc_code: 'P0113', oem_cost_min: 50,   oem_cost_max: 150,  aftermarket_cost_min: 15,  aftermarket_cost_max: 60,  labor_hours_min: 0.5, labor_hours_max: 1.0 },
  { dtc_code: 'P0102', oem_cost_min: 30,   oem_cost_max: 400,  aftermarket_cost_min: 10,  aftermarket_cost_max: 150, labor_hours_min: 0.5, labor_hours_max: 1.0 },
  { dtc_code: 'P0131', oem_cost_min: 80,   oem_cost_max: 300,  aftermarket_cost_min: 30,  aftermarket_cost_max: 120, labor_hours_min: 0.5, labor_hours_max: 1.5 },
  { dtc_code: 'P0135', oem_cost_min: 5,    oem_cost_max: 300,  aftermarket_cost_min: 5,   aftermarket_cost_max: 120, labor_hours_min: 0.5, labor_hours_max: 1.5 },
];

async function seed() {
  for (const b of benchmarks) {
    const laborMid = (b.labor_hours_min + b.labor_hours_max) / 2;
    const partsMid = (b.aftermarket_cost_min + b.aftermarket_cost_max) / 2;
    const fair     = partsMid + laborMid * LABOR_RATE;

    await pool.query(
      `INSERT INTO repair_cost_benchmarks
         (dtc_code, oem_cost_min, oem_cost_max,
          aftermarket_cost_min, aftermarket_cost_max,
          labor_hours_min, labor_hours_max, fair_cost_estimate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (dtc_code) DO UPDATE SET
         oem_cost_min         = EXCLUDED.oem_cost_min,
         oem_cost_max         = EXCLUDED.oem_cost_max,
         aftermarket_cost_min = EXCLUDED.aftermarket_cost_min,
         aftermarket_cost_max = EXCLUDED.aftermarket_cost_max,
         labor_hours_min      = EXCLUDED.labor_hours_min,
         labor_hours_max      = EXCLUDED.labor_hours_max,
         fair_cost_estimate   = EXCLUDED.fair_cost_estimate,
         updated_at           = NOW()`,
      [
        b.dtc_code,
        b.oem_cost_min, b.oem_cost_max,
        b.aftermarket_cost_min, b.aftermarket_cost_max,
        b.labor_hours_min, b.labor_hours_max,
        fair.toFixed(2),
      ]
    );
    console.log(`  seeded ${b.dtc_code}  fair=$${fair.toFixed(0)}`);
  }

  console.log(`Done — ${benchmarks.length} benchmarks seeded.`);
  await pool.end();
}

seed().catch(err => { console.error(err); process.exit(1); });
