'use strict';

/**
 * routes/alerts.js
 *
 * GET /api/alerts?vehicle_id=X&limit=20
 * Returns ML-dispatched foresight alerts for a vehicle, newest first.
 * Requires JWT auth.
 */

const express           = require('express');
const router            = express.Router();
const pool              = require('../config/db');
const authenticateToken = require('../middleware/auth');

router.get('/', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.query.vehicle_id, 10);
  const limit     = Math.min(parseInt(req.query.limit, 10) || 20, 100);

  if (!vehicleId || isNaN(vehicleId)) {
    return res.status(400).json({ error: 'vehicle_id is required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, vehicle_id, sensor, label, severity, detail,
              est_days, push_sent, resolved, alerted_at, created_at
         FROM foresight_alerts
        WHERE vehicle_id = $1
          AND user_id    = $2
        ORDER BY alerted_at DESC
        LIMIT $3`,
      [vehicleId, req.userId, limit],
    );
    res.json({ alerts: rows });
  } catch (err) {
    console.error('[alerts] query error:', err);
    res.status(500).json({ error: 'Could not fetch alerts' });
  }
});

module.exports = router;
