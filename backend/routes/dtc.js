const express = require('express');
const pool = require('../config/db');
const router = express.Router();

// GET /api/dtc?severity=high|medium|low
router.get('/', async (req, res) => {
  const { severity } = req.query;
  try {
    const { rows } = severity
      ? await pool.query(
          'SELECT * FROM dtc_codes WHERE severity = $1 ORDER BY code',
          [severity.toLowerCase()]
        )
      : await pool.query('SELECT * FROM dtc_codes ORDER BY code');
    res.json({ dtc_codes: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/dtc/:code
router.get('/:code', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM dtc_codes WHERE code = $1',
      [req.params.code.toUpperCase()]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'DTC code not found' });
    res.json({ dtc: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
