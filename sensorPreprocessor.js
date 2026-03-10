// backend/foresight/sensorPreprocessor.js
// Sanitizes raw OBD2 sensor readings before they feed into the Foresight ML model.
// Handles: -1 dropouts, flat-line spikes, out-of-range values, missing sensors.

// Valid operating ranges per sensor (physical limits for a typical passenger vehicle)
const SENSOR_BOUNDS = {
  engine_rpm:        { min: 0,    max: 8000,  unit: 'RPM' },
  coolant_temp:      { min: -40,  max: 130,   unit: 'C'   },
  lub_oil_temp:      { min: -40,  max: 150,   unit: 'C'   },
  battery_voltage:   { min: 9.0,  max: 16.0,  unit: 'V'   },
  fuel_pressure:     { min: 0,    max: 100,   unit: 'kPa' },
  lub_oil_pressure:  { min: 0,    max: 700,   unit: 'kPa' },
  coolant_pressure:  { min: 0,    max: 300,   unit: 'kPa' },
  intake_air_temp:   { min: -40,  max: 80,    unit: 'C'   },
  throttle_position: { min: 0,    max: 100,   unit: '%'   },
};

// Derived: temp_difference = coolant_temp - intake_air_temp
// Used by the GBM model as a key feature (mirrors iDharshan repo)

/**
 * Validates a single reading value against its sensor bounds.
 * Returns null (drop) if invalid, cleaned value if ok.
 * @param {string} sensorType
 * @param {number} value
 * @returns {number|null}
 */
function validateReading(sensorType, value) {
  // Drop OBD2 error sentinel values
  if (value === -1 || value === null || value === undefined || isNaN(value)) return null;

  const bounds = SENSOR_BOUNDS[sensorType];
  if (!bounds) return value; // unknown sensor — pass through

  if (value < bounds.min || value > bounds.max) return null; // out of physical range

  return value;
}

/**
 * Detects flat-line (stuck sensor) in an array of recent values.
 * Returns true if all values are identical (sensor is frozen).
 * @param {number[]} values - recent readings for one sensor
 * @returns {boolean}
 */
function isFlatLine(values, minLength = 5) {
  if (!values || values.length < minLength) return false;
  const recent = values.slice(-minLength);
  return recent.every(v => v === recent[0]);
}

/**
 * Detects a spike: value deviates more than N standard deviations from recent mean.
 * @param {number} value
 * @param {number[]} history - recent readings
 * @param {number} threshold - z-score cutoff (default 3)
 * @returns {boolean}
 */
function isSpike(value, history, threshold = 3) {
  if (!history || history.length < 3) return false;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / history.length;
  const std = Math.sqrt(variance);
  if (std === 0) return false;
  return Math.abs(value - mean) > threshold * std;
}

/**
 * Main preprocessing function.
 * Takes a snapshot of recent sensor readings grouped by type,
 * returns a cleaned + validated flat feature object for the GBM model.
 *
 * @param {Record<string, number[]>} sensorHistory
 *   e.g. { coolant_temp: [88, 90, 91, ...], battery_voltage: [14.1, 14.2, ...], ... }
 * @returns {{ features: Record<string, number|null>, quality: Record<string, string> }}
 */
function preprocessSensors(sensorHistory) {
  const features = {};
  const quality  = {}; // 'ok', 'flatline', 'spike', 'missing', 'dropout'

  for (const [type, values] of Object.entries(sensorHistory)) {
    if (!values || values.length === 0) {
      features[type] = null;
      quality[type]  = 'missing';
      continue;
    }

    // Get latest value
    const latest = values[values.length - 1];
    const cleaned = validateReading(type, latest);

    if (cleaned === null) {
      features[type] = null;
      quality[type]  = 'dropout';
      continue;
    }

    if (isFlatLine(values)) {
      features[type] = null;
      quality[type]  = 'flatline';
      continue;
    }

    const validHistory = values
      .map(v => validateReading(type, v))
      .filter(v => v !== null);

    if (isSpike(cleaned, validHistory)) {
      // Use median of recent history instead of the spike value
      const sorted = [...validHistory].sort((a, b) => a - b);
      features[type] = sorted[Math.floor(sorted.length / 2)];
      quality[type]  = 'spike_replaced';
    } else {
      features[type] = cleaned;
      quality[type]  = 'ok';
    }
  }

  // Derived feature: temp_difference (coolant_temp - intake_air_temp)
  if (features.coolant_temp !== null && features.intake_air_temp !== null) {
    features.temp_difference = parseFloat(
      (features.coolant_temp - features.intake_air_temp).toFixed(4)
    );
    quality.temp_difference = 'derived';
  } else {
    features.temp_difference = null;
    quality.temp_difference  = 'missing';
  }

  return { features, quality };
}

/**
 * Counts how many required sensors are valid for a reliable prediction.
 * Returns false if too many are missing to trust the model output.
 * @param {Record<string, number|null>} features
 * @param {number} minValidRatio - fraction of required sensors needed (default 0.7)
 * @returns {boolean}
 */
const REQUIRED_SENSORS = [
  'engine_rpm', 'coolant_temp', 'lub_oil_temp',
  'battery_voltage', 'fuel_pressure', 'lub_oil_pressure',
  'coolant_pressure', 'temp_difference',
];

function hasSufficientData(features, minValidRatio = 0.7) {
  const valid = REQUIRED_SENSORS.filter(s => features[s] !== null).length;
  return valid / REQUIRED_SENSORS.length >= minValidRatio;
}

module.exports = {
  preprocessSensors,
  hasSufficientData,
  validateReading,
  isFlatLine,
  isSpike,
  REQUIRED_SENSORS,
  SENSOR_BOUNDS,
};
