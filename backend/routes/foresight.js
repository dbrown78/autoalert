const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { analyzeVehicle } = require('../services/foresight');
const router = express.Router();

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    req.userId = jwt.verify(token, process.env.JWT_SECRET).id;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// GET /api/foresight/:vehicle_id
// Returns all active (unresolved) foresight alerts for a vehicle.
// Scoped to the authenticated user — cannot read another user's alerts.
router.get('/:vehicle_id', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.params.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'Invalid vehicle_id' });

  try {
    const { rows } = await pool.query(
      `SELECT id, sensor, label, severity, detail, reading, created_at, updated_at
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
// Returns the full set of currently triggered alerts after analysis.
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
