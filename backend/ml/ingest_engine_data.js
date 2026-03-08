/**
 * ingest_engine_data.js
 *
 * Bootstrap seeder for Foresight Phase 4 (ML model training).
 * Reads engine_data.csv and loads it into the foresight_training_data table.
 *
 * Usage:
 *   node ml/ingest_engine_data.js              # seed (skips if already loaded)
 *   node ml/ingest_engine_data.js --force      # truncate and reload
 *
 * -------------------------------------------------------------------------
 * COLUMN MAPPING: engine_data.csv → foresight_training_data
 * -------------------------------------------------------------------------
 *   Engine rpm          → rpm              OBD2 PID 0C. Dataset range: 61–2239 RPM.
 *                                          ODIN foresight monitors idle instability
 *                                          (stddev of values < 1200 RPM).
 *
 *   Lub oil pressure    → oil_pressure     No direct OBD2 PID standard; typically
 *                                          read via proprietary PIDs or sensors.
 *                                          Dataset unit: bar (range 0.003–7.27).
 *                                          Not currently in ODIN's telemetry_logs
 *                                          schema — will require schema extension
 *                                          before Phase 4 inference can use it.
 *
 *   Fuel pressure       → fuel_pressure    OBD2 PID 0A (fuel rail pressure).
 *                                          Dataset unit: bar (range 0.003–21.1).
 *                                          Not in current telemetry_logs schema.
 *
 *   Coolant pressure    → coolant_pressure No standard OBD2 PID. Dataset unit:
 *                                          bar (range 0.003–7.48). Not in current
 *                                          telemetry_logs schema.
 *
 *   lub oil temp        → oil_temp         OBD2 PID 5C (engine oil temp).
 *                                          Dataset range: 71.3–89.6 °C.
 *                                          Not in current telemetry_logs schema.
 *
 *   Coolant temp        → coolant_temp     OBD2 PID 05. Dataset range: 61.7–195.5 °C.
 *                                          Directly mapped to telemetry_logs.coolant_temp.
 *                                          ODIN threshold: avg > 108 °C triggers alert.
 *
 *   Engine Condition    → failure_label    Binary label. 0 = healthy (7,218 rows, 37%),
 *                                          1 = needs maintenance (12,317 rows, 63%).
 *                                          Class imbalance should be addressed in
 *                                          Phase 4 training (e.g. class_weight or SMOTE).
 *
 * -------------------------------------------------------------------------
 * ODIN OBD2 FIELDS NOT PRESENT IN THIS DATASET
 * -------------------------------------------------------------------------
 * These fields exist in telemetry_logs but have no equivalent in engine_data.csv.
 * Phase 4 will need supplemental datasets or synthetic augmentation for them:
 *
 *   battery_voltage     OBD2 read via AT RV. ODIN threshold: avg < 13.2 V.
 *   fuel_trim           OBD2 PIDs 06/07 (short/long-term). ODIN threshold: |avg| > 12%.
 *   engine_load         OBD2 PID 04 (calculated load value, 0–100%).
 *   o2_sensor           OBD2 PIDs 14-1B (lambda voltage).
 *   intake_temp         OBD2 PID 0F (intake air temperature).
 *   throttle_position   OBD2 PID 11 (0–100%).
 * -------------------------------------------------------------------------
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs      = require('fs');
const path    = require('path');
const readline = require('readline');
const pool    = require('../config/db');

const CSV_PATH   = path.join(__dirname, 'training_data', 'engine_data.csv');
const SOURCE_TAG = 'engine_data_v1';
const BATCH_SIZE = 500; // rows per INSERT; 8 params × 500 = 4000, well under PG's 65535 limit

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parse the CSV into an array of row objects.
 * Skips the header row and any malformed lines (wrong column count, non-numeric values).
 */
async function parseCSV(filePath) {
  const rows = [];
  let lineNum = 0;
  let skipped = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue; // skip header

    const parts = line.split(',');
    if (parts.length !== 7) { skipped++; continue; }

    const [rpm, oil_pressure, fuel_pressure, coolant_pressure,
           oil_temp, coolant_temp, engine_condition] = parts.map(Number);

    if ([rpm, oil_pressure, fuel_pressure, coolant_pressure,
         oil_temp, coolant_temp, engine_condition].some(isNaN)) {
      skipped++;
      continue;
    }

    const label = Math.round(engine_condition); // should be exactly 0 or 1
    if (label !== 0 && label !== 1) { skipped++; continue; }

    rows.push({ rpm, oil_pressure, fuel_pressure, coolant_pressure,
                oil_temp, coolant_temp, failure_label: label });
  }

  if (skipped > 0) {
    console.warn(`  Warning: skipped ${skipped} malformed row(s)`);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/**
 * Build a multi-row VALUES clause and flat params array for a batch of rows.
 * Each row contributes 8 parameters:
 *   $N   source (text literal)
 *   $N+1 rpm
 *   $N+2 oil_pressure
 *   $N+3 fuel_pressure
 *   $N+4 coolant_pressure
 *   $N+5 oil_temp
 *   $N+6 coolant_temp
 *   $N+7 failure_label
 */
function buildBatch(rows) {
  const values = [];
  const params = [];

  rows.forEach((row, i) => {
    const base = i * 8 + 1;
    values.push(
      `($${base},$${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7})`
    );
    params.push(
      SOURCE_TAG,
      row.rpm,
      row.oil_pressure,
      row.fuel_pressure,
      row.coolant_pressure,
      row.oil_temp,
      row.coolant_temp,
      row.failure_label
    );
  });

  return { values, params };
}

async function insertBatch(client, rows) {
  const { values, params } = buildBatch(rows);
  await client.query(
    `INSERT INTO foresight_training_data
       (source, rpm, oil_pressure, fuel_pressure, coolant_pressure,
        oil_temp, coolant_temp, failure_label)
     VALUES ${values.join(',')}`,
    params
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const force = process.argv.includes('--force');

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH}`);
    process.exit(1);
  }

  // Check if already seeded
  const { rows: existing } = await pool.query(
    `SELECT COUNT(*) AS n FROM foresight_training_data WHERE source = $1`,
    [SOURCE_TAG]
  );
  const existingCount = parseInt(existing[0].n, 10);

  if (existingCount > 0 && !force) {
    console.log(`Already seeded: ${existingCount} rows from source "${SOURCE_TAG}".`);
    console.log('Use --force to truncate and reload.');
    await pool.end();
    return;
  }

  if (force && existingCount > 0) {
    console.log(`--force: deleting ${existingCount} existing rows from source "${SOURCE_TAG}"...`);
    await pool.query(
      `DELETE FROM foresight_training_data WHERE source = $1`, [SOURCE_TAG]
    );
  }

  console.log(`Parsing ${CSV_PATH}...`);
  const rows = await parseCSV(CSV_PATH);
  console.log(`  Parsed ${rows.toLocaleString()} valid rows`);

  // Summary stats before insert
  const healthy = rows.filter(r => r.failure_label === 0).length;
  const fault   = rows.filter(r => r.failure_label === 1).length;
  console.log(`  Label distribution: ${healthy.toLocaleString()} healthy (0), ${fault.toLocaleString()} needs maintenance (1)`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const batches = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      batches.push(rows.slice(i, i + BATCH_SIZE));
    }

    console.log(`Inserting ${rows.toLocaleString()} rows in ${batches.length} batches of ≤${BATCH_SIZE}...`);

    for (let i = 0; i < batches.length; i++) {
      await insertBatch(client, batches[i]);
      if ((i + 1) % 10 === 0 || i === batches.length - 1) {
        const loaded = Math.min((i + 1) * BATCH_SIZE, rows.length);
        process.stdout.write(`\r  ${loaded.toLocaleString()} / ${rows.toLocaleString()} rows inserted`);
      }
    }

    await client.query('COMMIT');
    console.log(`\n✅ Seeded ${rows.toLocaleString()} training rows into foresight_training_data`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
