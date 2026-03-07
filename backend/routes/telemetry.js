const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
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

// POST /api/telemetry — log a batch of OBD2 sensor readings
// Body: { vehicle_id?, logged_at?, coolant_temp?, rpm?, voltage?,
//         o2_sensor?, fuel_trim?, engine_load?, intake_temp?, raw_data? }
router.post('/', authenticateToken, async (req, res) => {
  const {
    vehicle_id,
    logged_at,
    coolant_temp,
    rpm,
    voltage,
    o2_sensor,
    fuel_trim,
    engine_load,
    intake_temp,
    raw_data,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO telemetry_logs
         (user_id, vehicle_id, logged_at, coolant_temp, rpm, voltage,
          o2_sensor, fuel_trim, engine_load, intake_temp, raw_data)
       VALUES ($1,$2,COALESCE($3::timestamptz, NOW()),$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, logged_at`,
      [
        req.userId,
        vehicle_id ?? null,
        logged_at ?? null,
        coolant_temp ?? null,
        rpm ?? null,
        voltage ?? null,
        o2_sensor ?? null,
        fuel_trim ?? null,
        engine_load ?? null,
        intake_temp ?? null,
        raw_data ? JSON.stringify(raw_data) : null,
      ]
    );
    res.status(201).json({ log: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/telemetry?vehicle_id=&limit=100 — recent readings for a vehicle
router.get('/', authenticateToken, async (req, res) => {
  const { vehicle_id, limit = 100 } = req.query;
  const cap = Math.min(parseInt(limit, 10) || 100, 1000);

  try {
    const { rows } = await pool.query(
      `SELECT id, vehicle_id, logged_at,
              coolant_temp, rpm, voltage, o2_sensor,
              fuel_trim, engine_load, intake_temp, raw_data
       FROM telemetry_logs
       WHERE user_id = $1
         AND ($2::int IS NULL OR vehicle_id = $2::int)
       ORDER BY logged_at DESC
       LIMIT $3`,
      [req.userId, vehicle_id ?? null, cap]
    );
    res.json({ logs: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
