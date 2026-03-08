/**
 * sensorPreprocessor.js
 *
 * Sanitizes raw OBD2 telemetry rows before Foresight analysis.
 *
 * Pipeline (per sensor, applied in order):
 *   1. Extract non-null numeric values from DB rows (newest-first order preserved)
 *   2. Sentinel removal  — strip adapter error codes (commonly -1)
 *   3. Range validation  — drop physically impossible readings
 *   4. Spike removal     — IQR-based outlier filter (needs ≥ 4 clean values)
 *   5. Dropout detection — flag runs of ≥ 4 consecutive identical values
 *
 * Returns one PreprocessedSensor object per configured sensor, ready to pass
 * directly into a foresight rule's detect(values) call.
 *
 * @typedef {Object} PreprocessedSensor
 * @property {string}   sensor       - Sensor key (matches telemetry_logs column)
 * @property {number[]} clean        - Cleaned values, newest-first
 * @property {number}   rawCount     - How many non-null values were extracted
 * @property {number}   removed      - Total values discarded (sentinel + range + spike)
 * @property {number}   spikes       - Values removed by IQR filter
 * @property {number}   dropoutRuns  - Number of detected dropout (stuck-sensor) runs
 * @property {string[]} warnings     - Human-readable notes about what was found
 */

'use strict';

// ---------------------------------------------------------------------------
// Sensor definitions
// ---------------------------------------------------------------------------
// sentinel: the numeric value the ELM327 family returns when a PID is
//           unavailable or errored. null means no sentinel filter (e.g. fuel_trim
//           where -1% is a physically valid reading).
// min/max:  physically possible operating range. Values outside this window
//           are impossible given the OBD2 PID spec or engine physics and are
//           treated as adapter/parser corruption.
//
// Sources:
//   OBD2 PID spec (ISO 15031-5 / SAE J1979)
//   ELM327 datasheet — error responses decoded to -1 by common libraries

const SENSOR_CONFIG = {
  coolant_temp:      { sentinel: -1,   min: -40,  max: 215,  unit: '°C'  },
  rpm:               { sentinel: -1,   min: 0,    max: 8000, unit: 'RPM' },
  voltage:           { sentinel: -1,   min: 6,    max: 20,   unit: 'V'   },
  o2_sensor:         { sentinel: -1,   min: 0,    max: 5,    unit: 'V'   },
  fuel_trim:         { sentinel: null, min: -100, max: 99.2, unit: '%'   },
  engine_load:       { sentinel: -1,   min: 0,    max: 100,  unit: '%'   },
  intake_temp:       { sentinel: -1,   min: -40,  max: 215,  unit: '°C'  },
  // Extended sensors — added in migrate_telemetry_extended.js
  // Units sourced from engine_data.csv training dataset (iDharshan/ML-Based-Vehicle-
  // Predictive-Maintenance-System). -1 sentinel applies: adapters return -1 when
  // these proprietary PIDs are unavailable.
  oil_pressure:      { sentinel: -1,   min: 0,    max: 10,   unit: 'bar' },
  fuel_pressure:     { sentinel: -1,   min: 0,    max: 100,  unit: 'psi' },
  coolant_pressure:  { sentinel: -1,   min: 0,    max: 3,    unit: 'bar' },
};

// IQR fence multiplier. 1.5 is the standard Tukey fence; 2.5 is more
// conservative — appropriate here because real sensor excursions (a genuine
// hot-coolant event) should survive the filter.
const IQR_MULTIPLIER = 2.5;

// Minimum consecutive identical values (within float tolerance) to classify
// as a dropout / stuck-sensor run.
const DROPOUT_RUN_MIN = 4;

// Tolerance for "identical" float comparison (covers NUMERIC → JS rounding).
const FLOAT_EQ_TOLERANCE = 0.001;

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function quantile(sorted, p) {
  const idx = p * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ---------------------------------------------------------------------------
// Per-sensor pipeline steps
// ---------------------------------------------------------------------------

/**
 * Step 1 — extract non-null Numbers from DB rows for a given sensor column.
 * Preserves newest-first row order.
 */
function extractValues(rows, sensor) {
  const out = [];
  for (const row of rows) {
    const v = row[sensor];
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out.push(n);
  }
  return out;
}

/**
 * Step 2 — remove sentinel values.
 * Returns { kept, sentinelCount }.
 */
function removeSentinels(values, sentinel) {
  if (sentinel === null) return { kept: values, sentinelCount: 0 };
  const kept = values.filter(v => v !== sentinel);
  return { kept, sentinelCount: values.length - kept.length };
}

/**
 * Step 3 — drop values outside [min, max].
 * Returns { kept, rangeCount }.
 */
function removeOutOfRange(values, min, max) {
  const kept = values.filter(v => v >= min && v <= max);
  return { kept, rangeCount: values.length - kept.length };
}

/**
 * Step 4 — IQR-based spike removal (Tukey fence with configurable multiplier).
 * Requires ≥ 4 values to compute reliable quartiles; skips if fewer.
 * Returns { kept, spikeCount }.
 */
function removeSpikes(values) {
  if (values.length < 4) return { kept: values, spikeCount: 0 };

  const sorted = [...values].sort((a, b) => a - b);
  const q1  = quantile(sorted, 0.25);
  const q3  = quantile(sorted, 0.75);
  const iqr = q3 - q1;

  // If all values are identical (IQR = 0) there are no spikes to remove.
  if (iqr === 0) return { kept: values, spikeCount: 0 };

  const lower = q1 - IQR_MULTIPLIER * iqr;
  const upper = q3 + IQR_MULTIPLIER * iqr;

  const kept = values.filter(v => v >= lower && v <= upper);
  return { kept, spikeCount: values.length - kept.length };
}

/**
 * Step 5 — detect dropout (stuck-sensor) runs.
 * Does NOT remove values — analysis can still proceed but a warning is issued.
 * Returns { dropoutRuns, dropoutDetail[] }.
 */
function detectDropouts(values) {
  if (values.length < DROPOUT_RUN_MIN) return { dropoutRuns: 0, dropoutDetail: [] };

  const detail = [];
  let runStart = 0;
  let runLen   = 1;

  for (let i = 1; i <= values.length; i++) {
    const same =
      i < values.length &&
      Math.abs(values[i] - values[runStart]) < FLOAT_EQ_TOLERANCE;

    if (same) {
      runLen++;
    } else {
      if (runLen >= DROPOUT_RUN_MIN) {
        detail.push({ value: values[runStart], length: runLen, startIndex: runStart });
      }
      runStart = i;
      runLen   = 1;
    }
  }

  return { dropoutRuns: detail.length, dropoutDetail: detail };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Preprocess all configured sensors from a batch of telemetry_logs rows.
 *
 * @param {Object[]} rows - Raw DB rows, newest-first (as returned by the
 *                          SELECT ... ORDER BY logged_at DESC query in foresight.js)
 * @returns {Object.<string, PreprocessedSensor>} Map of sensor key → result
 */
function preprocessSensors(rows) {
  const result = {};

  for (const [sensor, cfg] of Object.entries(SENSOR_CONFIG)) {
    const warnings = [];

    // Step 1: extract
    const raw = extractValues(rows, sensor);

    // Step 2: sentinels
    const { kept: afterSentinel, sentinelCount } = removeSentinels(raw, cfg.sentinel);
    if (sentinelCount > 0) {
      warnings.push(`${sentinelCount} sentinel value${sentinelCount !== 1 ? 's' : ''} (-1) removed`);
    }

    // Step 3: range
    const { kept: afterRange, rangeCount } = removeOutOfRange(afterSentinel, cfg.min, cfg.max);
    if (rangeCount > 0) {
      warnings.push(
        `${rangeCount} out-of-range value${rangeCount !== 1 ? 's' : ''} removed ` +
        `(valid range: ${cfg.min}–${cfg.max} ${cfg.unit})`
      );
    }

    // Step 4: spikes
    const { kept: afterSpikes, spikeCount } = removeSpikes(afterRange);
    if (spikeCount > 0) {
      warnings.push(`${spikeCount} spike${spikeCount !== 1 ? 's' : ''} removed (IQR × ${IQR_MULTIPLIER} fence)`);
    }

    // Step 5: dropouts (flag only)
    const { dropoutRuns, dropoutDetail } = detectDropouts(afterSpikes);
    for (const d of dropoutDetail) {
      warnings.push(
        `Possible stuck sensor: ${d.value} ${cfg.unit} repeated ${d.length} times consecutively`
      );
    }

    const removed = sentinelCount + rangeCount + spikeCount;

    result[sensor] = {
      sensor,
      clean:       afterSpikes,
      rawCount:    raw.length,
      removed,
      spikes:      spikeCount,
      dropoutRuns,
      warnings,
    };
  }

  return result;
}

/**
 * Convenience wrapper: preprocess and return only the clean value array for a
 * single sensor. Equivalent to preprocessSensors(rows)[sensor].clean.
 * Useful in unit tests and REPL exploration.
 */
function preprocessSensor(rows, sensor) {
  if (!SENSOR_CONFIG[sensor]) {
    throw new Error(`Unknown sensor: "${sensor}". Valid sensors: ${Object.keys(SENSOR_CONFIG).join(', ')}`);
  }
  return preprocessSensors(rows)[sensor];
}

module.exports = { preprocessSensors, preprocessSensor, SENSOR_CONFIG };
