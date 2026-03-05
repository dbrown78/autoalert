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

// POST /api/scans — record a DTC lookup
router.post('/', authenticateToken, async (req, res) => {
  const { dtc_code, vehicle_id } = req.body;
  if (!dtc_code) return res.status(400).json({ message: 'dtc_code is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO scan_history (user_id, vehicle_id, dtc_code)
       VALUES ($1, $2, $3)
       RETURNING id, scanned_at`,
      [req.userId, vehicle_id ?? null, dtc_code.toUpperCase()]
    );
    res.status(201).json({ scan: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/scans — history for current user, joined with DTC + vehicle info
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         sh.id,
         sh.dtc_code,
         sh.scanned_at,
         sh.vehicle_id,
         d.short_description,
         d.severity,
         v.year  AS vehicle_year,
         v.make  AS vehicle_make,
         v.model AS vehicle_model
       FROM scan_history sh
       JOIN dtc_codes d ON d.code = sh.dtc_code
       LEFT JOIN vehicles v ON v.id = sh.vehicle_id
       WHERE sh.user_id = $1
       ORDER BY sh.scanned_at DESC
       LIMIT 200`,
      [req.userId]
    );
    res.json({ scans: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/scans/:id — remove a single entry (user-scoped)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM scan_history WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (rowCount === 0) return res.status(404).json({ message: 'Scan not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
