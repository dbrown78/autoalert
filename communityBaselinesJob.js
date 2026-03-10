// backend/jobs/communityBaselinesJob.js
// Nightly job that aggregates anonymized sensor data across all ODIN users
// and upserts stats into community_baselines per make/model/year/sensor_type.
//
// Privacy:
//   - Only aggregates make/model/year — no user_id or vehicle_id in output
//   - Minimum 5 vehicles required before publishing a baseline (k-anonymity floor)
//   - No raw readings are exposed — only mean, std, p10, p90
//
// Run via cron or node-cron:
//   const job = require('./jobs/communityBaselinesJob');
//   job.start(); // runs nightly at 2am
//
// Or manually: node -e "require('./jobs/communityBaselinesJob').runNow()"

const db       = require('../db');
const cron     = require('node-cron'); // npm install node-cron

const MIN_VEHICLE_COUNT = 5; // k-anonymity floor — don't publish baselines with < 5 vehicles

const SENSORS_TO_AGGREGATE = [
  'coolant_temp', 'battery_voltage', 'engine_rpm',
  'lub_oil_temp', 'lub_oil_pressure', 'coolant_pressure',
  'fuel_pressure', 'intake_air_temp', 'throttle_position',
];

/**
 * Main aggregation function.
 * Queries sensor_readings → joins vehicles → groups by make/model/year/sensor_type
 * → computes stats → upserts into community_baselines.
 */
async function aggregateBaselines() {
  console.log('[CommunityBaselines] Starting aggregation run...');
  const start = Date.now();
  let updated = 0;
  let skipped = 0;

  for (const sensor of SENSORS_TO_AGGREGATE) {
    const { rows } = await db.query(`
      SELECT
        v.make,
        v.model,
        v.year,
        COUNT(DISTINCT sr.vehicle_id)                        AS vehicle_count,
        AVG(sr.value::float)                                 AS mean_value,
        STDDEV(sr.value::float)                              AS std_value,
        PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY sr.value::float) AS p10_value,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY sr.value::float) AS p90_value
      FROM sensor_readings sr
      JOIN vehicles v ON v.id = sr.vehicle_id
      WHERE sr.sensor_type = $1
        AND sr.recorded_at > NOW() - INTERVAL '30 days'
        AND sr.quality >= 1
        AND v.make IS NOT NULL
        AND v.model IS NOT NULL
        AND v.year IS NOT NULL
      GROUP BY v.make, v.model, v.year
      HAVING COUNT(DISTINCT sr.vehicle_id) >= $2
    `, [sensor, MIN_VEHICLE_COUNT]);

    for (const row of rows) {
      await db.query(`
        INSERT INTO community_baselines
          (make, model, year, sensor_type, mean_value, std_value, p10_value, p90_value, sample_count, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (make, model, year, sensor_type)
        DO UPDATE SET
          mean_value   = EXCLUDED.mean_value,
          std_value    = EXCLUDED.std_value,
          p10_value    = EXCLUDED.p10_value,
          p90_value    = EXCLUDED.p90_value,
          sample_count = EXCLUDED.sample_count,
          updated_at   = NOW()
      `, [
        row.make, row.model, row.year, sensor,
        row.mean_value, row.std_value,
        row.p10_value, row.p90_value,
        row.vehicle_count,
      ]);
      updated++;
    }

    skipped += rows.filter(r => r.vehicle_count < MIN_VEHICLE_COUNT).length;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[CommunityBaselines] Done in ${elapsed}s — ${updated} baselines updated, ${skipped} skipped (below k-anonymity floor)`);
}

/**
 * Computes z-score deviation for a given vehicle's sensor reading vs community baseline.
 * Returns a human-readable insight string.
 *
 * @param {string} make
 * @param {string} model
 * @param {number} year
 * @param {string} sensorType
 * @param {number} vehicleValue  — the vehicle's current mean reading
 * @returns {{ zScore: number, percentDiff: number, insight: string } | null}
 */
async function getBaselineInsight(make, model, year, sensorType, vehicleValue) {
  const { rows } = await db.query(`
    SELECT mean_value, std_value, sample_count
    FROM community_baselines
    WHERE make = $1 AND model = $2 AND year = $3 AND sensor_type = $4
  `, [make, model, year, sensorType]);

  if (!rows.length || rows[0].std_value === 0) return null;

  const { mean_value, std_value, sample_count } = rows[0];
  const mean     = parseFloat(mean_value);
  const std      = parseFloat(std_value);
  const zScore   = (vehicleValue - mean) / std;
  const pctDiff  = ((vehicleValue - mean) / mean) * 100;

  const direction = pctDiff > 0 ? 'higher' : 'lower';
  const absPct    = Math.abs(pctDiff).toFixed(1);

  let insight = null;
  if (Math.abs(pctDiff) >= 5) {
    insight = `${absPct}% ${direction} than other ${year} ${make} ${model}s (${sample_count} vehicles)`;
  }

  return { zScore: parseFloat(zScore.toFixed(3)), percentDiff: parseFloat(pctDiff.toFixed(2)), insight };
}

// ── Cron schedule ─────────────────────────────────────────────────────────────

function start() {
  // Run every night at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      await aggregateBaselines();
    } catch (err) {
      console.error('[CommunityBaselines] Job error:', err.message);
    }
  });
  console.log('[CommunityBaselines] Scheduled for nightly 2:00 AM');
}

async function runNow() {
  try {
    await aggregateBaselines();
  } catch (err) {
    console.error('[CommunityBaselines] Manual run error:', err.message);
  }
}

module.exports = { start, runNow, getBaselineInsight };
