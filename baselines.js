// backend/routes/baselines.js
// Community baseline lookup endpoint for SensorHistoryDashboard
// Powers the "X% higher than similar vehicles" Foresight insight

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/baselines?make=Toyota&model=Camry&year=2019&sensor=coolant_temp
router.get('/', authenticateToken, async (req, res) => {
  const { make, model, year, sensor } = req.query;

  if (!make || !model || !year || !sensor) {
    return res.status(400).json({ error: 'make, model, year, sensor all required' });
  }

  const { rows } = await db.query(`
    SELECT sensor_type, mean_value, std_value, p10_value, p90_value, sample_count, updated_at
    FROM community_baselines
    WHERE make = $1 AND model = $2 AND year = $3 AND sensor_type = $4
  `, [make, model, parseInt(year), sensor]);

  if (!rows.length) {
    return res.status(404).json({ error: 'No baseline yet for this vehicle + sensor combination' });
  }

  res.json({ baseline: rows[0] });
});

// GET /api/baselines/all?make=Toyota&model=Camry&year=2019
// Returns all sensor baselines for a vehicle — used to enrich Foresight response
router.get('/all', authenticateToken, async (req, res) => {
  const { make, model, year } = req.query;

  if (!make || !model || !year) {
    return res.status(400).json({ error: 'make, model, year required' });
  }

  const { rows } = await db.query(`
    SELECT sensor_type, mean_value, std_value, p10_value, p90_value, sample_count
    FROM community_baselines
    WHERE make = $1 AND model = $2 AND year = $3
    ORDER BY sensor_type
  `, [make, model, parseInt(year)]);

  const baselines = {};
  for (const row of rows) {
    baselines[row.sensor_type] = {
      mean: parseFloat(row.mean_value),
      std:  parseFloat(row.std_value),
      p10:  parseFloat(row.p10_value),
      p90:  parseFloat(row.p90_value),
      sample_count: row.sample_count,
    };
  }

  res.json({ make, model, year, baselines });
});

module.exports = router;
