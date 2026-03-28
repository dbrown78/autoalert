'use strict';

/**
 * alertDispatcher.js
 *
 * Processes a Foresight ML prediction and dispatches push alerts for
 * failure modes that cross severity thresholds.
 *
 * Thresholds — an alert is dispatched when ANY of these are true:
 *   • failure_mode.probability >= 0.50
 *   • failure_mode is in the top-3 ranked modes
 *   • overall days_to_failure_estimate <= 30
 *
 * Severity mapping:
 *   probability >= 0.70  → high
 *   probability >= 0.50  → medium
 *   otherwise            → low
 *
 * Deduplication: a (vehicle_id, sensor) alert is only inserted if no
 * unresolved alert for that pair already exists (created in last 24h).
 */

const pool              = require('../config/db');
const { sendForesightAlert } = require('./pushNotifications');

/**
 * Compute severity label from failure probability.
 * @param {number} prob  0–1
 * @returns {'high'|'medium'|'low'}
 */
function computeSeverity(prob) {
  if (prob >= 0.70) return 'high';
  if (prob >= 0.50) return 'medium';
  return 'low';
}

/**
 * Process a Foresight prediction payload and fire push alerts.
 *
 * @param {number} userId     - Authenticated user ID
 * @param {number} vehicleId  - Vehicle the prediction is for
 * @param {Object} prediction - Response from foresightClient.predict()
 * @returns {Promise<number>} Number of alerts dispatched
 */
async function dispatch(userId, vehicleId, prediction) {
  const { top_failure_modes = [], days_to_failure_estimate } = prediction;

  const urgentOverall = typeof days_to_failure_estimate === 'number'
    && days_to_failure_estimate <= 30;

  let dispatched = 0;

  for (let rank = 0; rank < top_failure_modes.length; rank++) {
    const mode = top_failure_modes[rank];
    const inTopThree  = rank < 3;
    const highProb    = (mode.probability ?? 0) >= 0.50;

    if (!highProb && !inTopThree && !urgentOverall) continue;

    const severity = computeSeverity(mode.probability ?? 0);
    const sensor   = mode.mode        ?? 'unknown';
    const label    = mode.display_name ?? sensor;
    const detail   = mode.dtc_code
      ? `DTC ${mode.dtc_code} — ${label} (${Math.round((mode.probability ?? 0) * 100)}% probability)`
      : `${label} — ${Math.round((mode.probability ?? 0) * 100)}% probability`;

    // Dedup: skip if an unresolved alert for this sensor was created < 24h ago
    const { rows: existing } = await pool.query(
      `SELECT id FROM foresight_alerts
        WHERE vehicle_id = $1
          AND user_id    = $2
          AND sensor     = $3
          AND resolved   = false
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1`,
      [vehicleId, userId, sensor],
    );
    if (existing.length > 0) continue;

    // Insert alert row
    const { rows: [alert] } = await pool.query(
      `INSERT INTO foresight_alerts
         (user_id, vehicle_id, sensor, label, severity, detail,
          est_days, push_sent, resolved, alerted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, NOW())
       RETURNING *`,
      [
        userId, vehicleId, sensor, label, severity, detail,
        days_to_failure_estimate ?? null,
      ],
    );

    // Fire push notification (non-blocking — errors logged, not rethrown)
    try {
      await sendForesightAlert(userId, alert);
      await pool.query(
        `UPDATE foresight_alerts SET push_sent = true WHERE id = $1`,
        [alert.id],
      );
    } catch (err) {
      console.error(`[alertDispatcher] push failed for alert ${alert.id}:`, err.message);
    }

    console.log(
      `[alertDispatcher] dispatched alert ${alert.id} — ` +
      `vehicle=${vehicleId} sensor=${sensor} severity=${severity}`,
    );
    dispatched++;
  }

  return dispatched;
}

module.exports = { dispatch };
