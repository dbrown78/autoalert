// backend/routes/foresight.js
// Express bridge to the Foresight FastAPI microservice.
// Handles: premium gating, prediction caching, DB persistence.

const express = require('express');
const router  = express.Router();
const fetch   = require('node-fetch');      // npm install node-fetch@2
const db      = require('../db');
const { authenticateToken } = require('../middleware/auth');

const FORESIGHT_URL      = process.env.FORESIGHT_SERVICE_URL || 'http://localhost:8001';
const FORESIGHT_INT_KEY  = process.env.FORESIGHT_INTERNAL_KEY || 'odin-internal-2024';
const CACHE_TTL_MINUTES  = 10; // don't re-run ML within 10 min of last prediction

// ── Premium gate middleware ───────────────────────────────────────────────────

async function requirePremium(req, res, next) {
  const { rows } = await db.query(
    'SELECT is_premium FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows.length || !rows[0].is_premium) {
    return res.status(403).json({
      error:   'premium_required',
      message: 'Foresight ML predictions are a premium feature. Upgrade to unlock.',
    });
  }
  next();
}

// ── GET /api/foresight/:vehicleId ─────────────────────────────────────────────
// Returns latest Foresight prediction. Uses cache if fresh enough.

router.get('/:vehicleId', authenticateToken, requirePremium, async (req, res) => {
  const { vehicleId } = req.params;
  const { force = false } = req.query; // ?force=true bypasses cache

  // Verify vehicle belongs to user
  const { rows: vehicles } = await db.query(
    'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2',
    [vehicleId, req.user.id]
  );
  if (!vehicles.length) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  // Check cache — return stored prediction if fresh
  if (!force) {
    const { rows: cached } = await db.query(`
      SELECT * FROM foresight_predictions
      WHERE vehicle_id = $1
        AND predicted_at > NOW() - INTERVAL '${CACHE_TTL_MINUTES} minutes'
      ORDER BY predicted_at DESC
      LIMIT 1
    `, [vehicleId]);

    if (cached.length) {
      return res.json({
        source: 'cache',
        ...formatPrediction(cached[0]),
      });
    }
  }

  // Call Foresight Python service
  try {
    const response = await fetch(`${FORESIGHT_URL}/predict/${vehicleId}`, {
      headers: { 'x-internal-key': FORESIGHT_INT_KEY },
      timeout: 15000,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error:   'foresight_error',
        message: body.detail || 'Prediction service error',
      });
    }

    const prediction = await response.json();

    // Persist prediction to DB
    const { rows: saved } = await db.query(`
      INSERT INTO foresight_predictions
        (vehicle_id, maintenance_probability, maintenance_urgency,
         estimated_service_date, days_until_service, part_scores, feature_snapshot, is_premium)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      vehicleId,
      prediction.maintenance_probability,
      prediction.maintenance_urgency,
      prediction.estimated_service_date || null,
      prediction.days_until_service     || null,
      JSON.stringify(prediction.part_scores),
      JSON.stringify({}),  // feature_snapshot can be added if you want audit trail
      true,
    ]);

    return res.json({
      source: 'live',
      ...formatPrediction(saved[0]),
      data_quality: prediction.data_quality,
    });

  } catch (err) {
    console.error('[Foresight] Service call failed:', err.message);
    return res.status(503).json({
      error:   'service_unavailable',
      message: 'Foresight service is starting up. Try again in a moment.',
    });
  }
});

// ── GET /api/foresight/:vehicleId/history ─────────────────────────────────────
// Historical prediction log for trend display

router.get('/:vehicleId/history', authenticateToken, requirePremium, async (req, res) => {
  const { vehicleId } = req.params;
  const { limit = 30 } = req.query;

  const { rows } = await db.query(`
    SELECT * FROM foresight_predictions
    WHERE vehicle_id = $1
    ORDER BY predicted_at DESC
    LIMIT $2
  `, [vehicleId, Math.min(parseInt(limit), 100)]);

  res.json({
    vehicle_id: vehicleId,
    predictions: rows.map(formatPrediction),
  });
});

// ── Format helper ─────────────────────────────────────────────────────────────

function formatPrediction(row) {
  return {
    id:                      row.id,
    vehicle_id:              row.vehicle_id,
    predicted_at:            row.predicted_at,
    maintenance_probability: parseFloat(row.maintenance_probability),
    maintenance_urgency:     row.maintenance_urgency,
    estimated_service_date:  row.estimated_service_date,
    days_until_service:      row.days_until_service,
    part_scores:             typeof row.part_scores === 'string'
                               ? JSON.parse(row.part_scores)
                               : row.part_scores,
    is_premium:              row.is_premium,
  };
}

module.exports = router;
