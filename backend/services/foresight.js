'use strict';

const pool = require('../config/db');
const { preprocessSensors } = require('./sensorPreprocessor');
const { sendForesightAlert } = require('./pushNotifications');

// ---------------------------------------------------------------------------
// Helper — rolling average of first N values (newest-first)
// ---------------------------------------------------------------------------
function avg(values, n) {
  const slice = values.slice(0, n);
  if (slice.length === 0) return null;
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------
const RULES = [
  // COOLANT SYSTEM
  {
    id: 'coolant_overheat_critical',
    sensor: 'coolant_temp',
    sensor_label: 'Coolant Temperature',
    system: 'coolant',
    severity: 'high',
    rule_description: 'Coolant temperature critically high — engine at risk of overheating',
    detect(values) { return values.slice(0, 10).some(v => v > 105); },
  },
  {
    id: 'coolant_overheat_warning',
    sensor: 'coolant_temp',
    sensor_label: 'Coolant Temperature',
    system: 'coolant',
    severity: 'medium',
    rule_description: 'Coolant running hotter than normal — monitor closely',
    detect(values) { const a = avg(values, 10); return a !== null && a > 95; },
  },
  {
    id: 'coolant_pressure_high',
    sensor: 'coolant_pressure',
    sensor_label: 'Coolant Pressure',
    system: 'coolant',
    severity: 'medium',
    rule_description: 'Coolant pressure elevated — possible blockage or failing cap',
    detect(values) { return values.some(v => v > 2.0); },
  },

  // BATTERY / CHARGING
  {
    id: 'voltage_critical_low',
    sensor: 'voltage',
    sensor_label: 'Battery Voltage',
    system: 'battery',
    severity: 'high',
    rule_description: 'Battery voltage critically low — possible charging system failure',
    detect(values) { return values.some(v => v < 11.5); },
  },
  {
    id: 'voltage_low',
    sensor: 'voltage',
    sensor_label: 'Battery Voltage',
    system: 'battery',
    severity: 'medium',
    rule_description: 'Battery voltage below optimal — check charging system',
    detect(values) { const a = avg(values, values.length); return a !== null && a < 12.4; },
  },
  {
    id: 'voltage_high',
    sensor: 'voltage',
    sensor_label: 'Battery Voltage',
    system: 'battery',
    severity: 'low',
    rule_description: 'Battery voltage elevated — possible overcharging',
    detect(values) { return values.some(v => v > 15.0); },
  },

  // OIL SYSTEM
  {
    id: 'oil_pressure_critical',
    sensor: 'oil_pressure',
    sensor_label: 'Oil Pressure',
    system: 'oil',
    severity: 'high',
    rule_description: 'Oil pressure critically low — stop engine immediately',
    detect(values) { return values.some(v => v < 0.5); },
  },
  {
    id: 'oil_pressure_low',
    sensor: 'oil_pressure',
    sensor_label: 'Oil Pressure',
    system: 'oil',
    severity: 'medium',
    rule_description: 'Oil pressure below normal range — check oil level',
    detect(values) { const a = avg(values, values.length); return a !== null && a < 1.0; },
  },

  // GENERAL ENGINE
  {
    id: 'rpm_excessive',
    sensor: 'rpm',
    sensor_label: 'Engine RPM',
    system: 'engine',
    severity: 'medium',
    rule_description: 'Engine running at high RPM consistently — check for issues',
    detect(values) { const a = avg(values, 5); return a !== null && a > 4500; },
  },
  {
    id: 'engine_load_high',
    sensor: 'engine_load',
    sensor_label: 'Engine Load',
    system: 'engine',
    severity: 'low',
    rule_description: 'Engine load consistently high — may indicate strain',
    detect(values) { const a = avg(values, values.length); return a !== null && a > 85; },
  },
  {
    id: 'fuel_trim_rich',
    sensor: 'fuel_trim',
    sensor_label: 'Fuel Trim',
    system: 'engine',
    severity: 'low',
    rule_description: 'Fuel trim running rich — possible sensor or injector issue',
    detect(values) { const a = avg(values, values.length); return a !== null && a > 25; },
  },
  {
    id: 'fuel_trim_lean',
    sensor: 'fuel_trim',
    sensor_label: 'Fuel Trim',
    system: 'engine',
    severity: 'low',
    rule_description: 'Fuel trim running lean — possible vacuum leak or MAF issue',
    detect(values) { const a = avg(values, values.length); return a !== null && a < -25; },
  },
];

// Build rule_id → system map for getHealthScores
const SYSTEM_BY_RULE = {};
for (const rule of RULES) {
  SYSTEM_BY_RULE[rule.id] = rule.system;
}

// ---------------------------------------------------------------------------
// analyzeVehicle
// ---------------------------------------------------------------------------
async function analyzeVehicle(userId, vehicleId) {
  // 1. Fetch last 50 telemetry rows, newest-first
  const { rows: logs } = await pool.query(
    `SELECT * FROM telemetry_logs
     WHERE user_id = $1 AND vehicle_id = $2
     ORDER BY logged_at DESC
     LIMIT 50`,
    [userId, vehicleId]
  );

  if (logs.length === 0) return [];

  // 2. Preprocess all sensors
  const preprocessed = preprocessSensors(logs);

  // 3 & 4 & 5. Evaluate each rule and upsert/resolve
  for (const rule of RULES) {
    const sensorData = preprocessed[rule.sensor];
    const values = sensorData ? sensorData.clean : [];
    const fires = values.length > 0 && rule.detect(values);
    const reading = values[0] ?? null;

    if (fires) {
      // 4. UPSERT triggered alert
      const { rows } = await pool.query(
        `INSERT INTO foresight_alerts
           (user_id, vehicle_id, rule_id, sensor, label, severity, detail, reading, resolved)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
         ON CONFLICT (user_id, vehicle_id, rule_id) WHERE resolved = FALSE
         DO UPDATE SET
           severity   = EXCLUDED.severity,
           detail     = EXCLUDED.detail,
           reading    = EXCLUDED.reading,
           updated_at = NOW(),
           resolved   = FALSE
         RETURNING *, (xmax = 0) AS is_new`,
        [userId, vehicleId, rule.id, rule.sensor, rule.sensor_label,
         rule.severity, rule.rule_description, reading]
      );

      const alert = rows[0];
      if (alert.is_new) {
        sendForesightAlert(userId, alert).catch(err =>
          console.error(`[foresight] push notification failed for alert ${alert.id}:`, err)
        );
      }
    } else {
      // 5. Resolve if previously active
      await pool.query(
        `UPDATE foresight_alerts
         SET resolved = TRUE, resolved_at = NOW()
         WHERE user_id = $1 AND vehicle_id = $2 AND rule_id = $3 AND resolved = FALSE`,
        [userId, vehicleId, rule.id]
      );
    }
  }

  // 6. Return all currently active alerts
  const { rows: activeAlerts } = await pool.query(
    `SELECT id, rule_id, sensor, label, severity, detail, reading, created_at, updated_at
     FROM foresight_alerts
     WHERE user_id = $1 AND vehicle_id = $2 AND resolved = FALSE
     ORDER BY
       CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       updated_at DESC`,
    [userId, vehicleId]
  );

  return activeAlerts;
}

// ---------------------------------------------------------------------------
// getHealthScores
// ---------------------------------------------------------------------------
const SEVERITY_PENALTY = { high: 0.8, medium: 0.5, low: 0.25 };

async function getHealthScores(userId, vehicleId) {
  const { rows: alerts } = await pool.query(
    `SELECT rule_id, severity FROM foresight_alerts
     WHERE user_id = $1 AND vehicle_id = $2 AND resolved = FALSE`,
    [userId, vehicleId]
  );

  const scores = { coolant: 1.0, battery: 1.0, oil: 1.0, brakes: 1.0 };

  for (const alert of alerts) {
    const system = SYSTEM_BY_RULE[alert.rule_id];
    if (!system || !(system in scores)) continue;
    const penalty = SEVERITY_PENALTY[alert.severity] ?? 0;
    const score = 1.0 - penalty;
    if (score < scores[system]) scores[system] = score;
  }

  return scores;
}

module.exports = { analyzeVehicle, getHealthScores };
