'use strict';

const express = require('express');
const pool = require('../config/db');
const { analyzeVehicle, getHealthScores } = require('../services/foresight');
const authenticateToken = require('../middleware/auth');
const requirePremium    = require('../middleware/requirePremium');
const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/foresight/health?vehicle_id=X
// Rule-based system health scores { coolant, battery, oil, brakes }
// ---------------------------------------------------------------------------
router.get('/health', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.query.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'vehicle_id is required' });

  try {
    const health = await getHealthScores(req.userId, vehicleId);
    res.json({ health });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/foresight/alerts?vehicle_id=X
// Active (unresolved) rule-based foresight alerts
// ---------------------------------------------------------------------------
router.get('/alerts', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.query.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'vehicle_id is required' });

  try {
    const { rows } = await pool.query(
      `SELECT id, rule_id, sensor, label, severity, detail, reading, created_at, updated_at
       FROM foresight_alerts
       WHERE user_id = $1 AND vehicle_id = $2 AND resolved = FALSE
       ORDER BY
         CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         updated_at DESC`,
      [req.userId, vehicleId]
    );
    res.json({ alerts: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/foresight/analyze
// Run rule engine, upsert alerts, return active alerts
// ---------------------------------------------------------------------------
router.post('/analyze', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.body.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'vehicle_id is required' });

  try {
    const alerts = await analyzeVehicle(req.userId, vehicleId);
    res.json({ alerts, analyzed_at: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/foresight/ml-admin/retrain
// Proxy to FastAPI retrain endpoint (admin — authenticated users only)
// ---------------------------------------------------------------------------
router.post('/ml-admin/retrain', authenticateToken, async (req, res) => {
  const serviceUrl = process.env.FORESIGHT_SERVICE_URL;
  if (!serviceUrl) return res.status(503).json({ message: 'Foresight service not configured' });

  try {
    const response = await fetch(`${serviceUrl}/retrain`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': process.env.FORESIGHT_INTERNAL_KEY || '',
      },
      signal: AbortSignal.timeout(300_000), // 5 min for training
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ message: 'Retrain failed', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/foresight/:vehicle_id
// ML-powered prediction (premium required).
// Calls the FastAPI Foresight service; persists result to foresight_predictions.
// ---------------------------------------------------------------------------
router.get('/:vehicle_id', authenticateToken, requirePremium, async (req, res) => {
  const vehicleId = parseInt(req.params.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'Invalid vehicle_id' });

  const serviceUrl   = process.env.FORESIGHT_SERVICE_URL;
  const internalKey  = process.env.FORESIGHT_INTERNAL_KEY || '';

  if (!serviceUrl) {
    return res.status(503).json({ message: 'Foresight service not configured' });
  }

  try {
    const response = await fetch(`${serviceUrl}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': internalKey,
      },
      body: JSON.stringify({ vehicle_id: vehicleId, user_id: req.userId }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ message: err.detail || 'Prediction failed' });
    }

    const prediction = await response.json();

    // Persist prediction for history / retraining
    await pool.query(
      `INSERT INTO foresight_predictions
         (user_id, vehicle_id, maintenance_probability, maintenance_urgency,
          estimated_service_date, days_until_service, part_scores, data_quality, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.userId,
        vehicleId,
        prediction.maintenance_probability,
        prediction.maintenance_urgency,
        prediction.estimated_service_date,
        prediction.days_until_service,
        JSON.stringify(prediction.part_scores),
        prediction.data_quality,
        prediction.source,
      ]
    );

    res.json(prediction);
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ message: 'Foresight service timeout' });
    }
    console.error('[foresight] ML service error:', err.message);
    res.status(502).json({ message: 'Foresight service unavailable' });
  }
});

module.exports = router;
