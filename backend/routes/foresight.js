const express = require('express');
const pool = require('../config/db');
const { analyzeVehicle, getHealthScores } = require('../services/foresight');
const authenticateToken = require('../middleware/auth');
const router = express.Router();

// GET /api/foresight/health?vehicle_id=X
// Returns system health scores (coolant, battery, oil, brakes) derived from active alerts.
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

// GET /api/foresight/alerts?vehicle_id=X
// Returns all active (unresolved) foresight alerts for a vehicle.
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

// GET /api/foresight/:vehicle_id
// Returns all active (unresolved) foresight alerts for a vehicle (legacy route).
router.get('/:vehicle_id', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.params.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'Invalid vehicle_id' });

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

// POST /api/foresight/analyze
// Body: { vehicle_id }
// Runs the rule engine against recent telemetry and upserts foresight_alerts.
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

module.exports = router;
