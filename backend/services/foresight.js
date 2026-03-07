const pool = require('../config/db');

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------
const RULES = {
  // Coolant temp: normal operating range 85–105 °C.
  // "Creep" = recent average trending above 108 °C.
  coolant_temp: {
    label: 'Coolant Temperature Creep',
    sensor: 'coolant_temp',
    severity: 'high',
    minSamples: 5,
    detect(values) {
      const recent = values.slice(0, 10);
      const avg = mean(recent);
      if (avg > 108) {
        return {
          detail: `Average coolant temp over last ${recent.length} readings: ${avg.toFixed(1)} °C (threshold: 108 °C)`,
          reading: avg,
        };
      }
    },
  },

  // Voltage: healthy charging system 13.7–14.7 V at idle.
  // "Drop" = recent average below 13.2 V (alternator strain / battery fade).
  voltage: {
    label: 'Charging System Voltage Drop',
    sensor: 'voltage',
    severity: 'medium',
    minSamples: 3,
    detect(values) {
      const recent = values.slice(0, 8);
      const avg = mean(recent);
      if (avg < 13.2) {
        return {
          detail: `Average voltage over last ${recent.length} readings: ${avg.toFixed(2)} V (threshold: 13.2 V)`,
          reading: avg,
        };
      }
    },
  },

  // Fuel trim: short/long-term trim should sit within ±10 %.
  // "Drift" = average magnitude exceeds 12 % (lean/rich condition developing).
  fuel_trim: {
    label: 'Fuel Trim Drift',
    sensor: 'fuel_trim',
    severity: 'medium',
    minSamples: 5,
    detect(values) {
      const recent = values.slice(0, 10);
      const avg = mean(recent.map(Math.abs));
      if (avg > 12) {
        const direction = mean(recent) > 0 ? 'lean' : 'rich';
        return {
          detail: `Average |fuel trim| over last ${recent.length} readings: ${avg.toFixed(1)} % — running ${direction} (threshold: ±12 %)`,
          reading: avg,
        };
      }
    },
  },

  // RPM: idle instability — standard deviation of idle-range RPM samples > 150.
  // Only evaluated on samples plausibly at idle (< 1200 RPM).
  rpm: {
    label: 'RPM Instability at Idle',
    sensor: 'rpm',
    severity: 'low',
    minSamples: 5,
    detect(values) {
      const idle = values.filter(v => v < 1200).slice(0, 20);
      if (idle.length < 5) return;
      const sd = stddev(idle);
      if (sd > 150) {
        return {
          detail: `Idle RPM std deviation over ${idle.length} samples: ${sd.toFixed(0)} RPM (threshold: 150 RPM)`,
          reading: sd,
        };
      }
    },
  },
};

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

/**
 * Analyze the last N telemetry rows for a vehicle and upsert foresight_alerts.
 * Returns the list of triggered alerts (new + existing active).
 */
async function analyzeVehicle(userId, vehicleId) {
  // Pull the 50 most recent rows that have at least one sensor populated.
  const { rows: logs } = await pool.query(
    `SELECT coolant_temp, rpm, voltage, o2_sensor, fuel_trim, engine_load, intake_temp
     FROM telemetry_logs
     WHERE user_id = $1
       AND vehicle_id = $2
       AND (coolant_temp IS NOT NULL OR rpm IS NOT NULL OR voltage IS NOT NULL
            OR fuel_trim IS NOT NULL OR engine_load IS NOT NULL)
     ORDER BY logged_at DESC
     LIMIT 50`,
    [userId, vehicleId]
  );

  if (logs.length === 0) return [];

  const triggered = [];

  for (const rule of Object.values(RULES)) {
    const values = logs
      .map(r => r[rule.sensor])
      .filter(v => v !== null && v !== undefined)
      .map(Number);

    if (values.length < rule.minSamples) continue;

    const result = rule.detect(values);
    if (!result) {
      // Rule not triggered — resolve any existing open alert for this sensor.
      await pool.query(
        `UPDATE foresight_alerts
         SET resolved = TRUE, resolved_at = NOW()
         WHERE user_id = $1 AND vehicle_id = $2 AND sensor = $3 AND resolved = FALSE`,
        [userId, vehicleId, rule.sensor]
      );
      continue;
    }

    // Upsert: if an unresolved alert for this sensor already exists, update it;
    // otherwise insert a new one.
    const { rows } = await pool.query(
      `INSERT INTO foresight_alerts
         (user_id, vehicle_id, sensor, label, severity, detail, reading, resolved)
       VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)
       ON CONFLICT (user_id, vehicle_id, sensor)
         WHERE resolved = FALSE
       DO UPDATE SET
         detail     = EXCLUDED.detail,
         reading    = EXCLUDED.reading,
         updated_at = NOW()
       RETURNING *`,
      [userId, vehicleId, rule.sensor, rule.label, rule.severity, result.detail, result.reading]
    );
    triggered.push(rows[0]);
  }

  return triggered;
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------
function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

module.exports = { analyzeVehicle };
