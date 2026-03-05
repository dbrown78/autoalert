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

// GET /api/dtc/:code?make=Toyota&model=Camry&year=2012
// When make+year are provided, checks for a vehicle-specific override and merges it.
router.get('/:code', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { make, model, year } = req.query;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM dtc_codes WHERE code = $1',
      [code]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'DTC code not found' });

    const dtc = { ...rows[0], vehicle_specific: false };

    if (make && year) {
      const yearInt = parseInt(year, 10);
      const { rows: overrides } = await pool.query(
        `SELECT * FROM dtc_vehicle_overrides
         WHERE dtc_code = $1
           AND LOWER(make) = LOWER($2)
           AND (model IS NULL OR LOWER(model) = LOWER($3))
           AND (year_min IS NULL OR year_min <= $4)
           AND (year_max IS NULL OR year_max >= $4)
         ORDER BY
           (model IS NOT NULL)::int DESC,
           (year_min IS NOT NULL)::int DESC
         LIMIT 1`,
        [code, make, model || '', yearInt]
      );

      if (overrides.length > 0) {
        const ov = overrides[0];
        const mergeFields = [
          'possible_causes', 'symptoms',
          'oem_cost_min', 'oem_cost_max',
          'aftermarket_cost_min', 'aftermarket_cost_max',
          'labor_hours_min', 'labor_hours_max',
          'diy_difficulty', 'notes',
        ];
        for (const field of mergeFields) {
          if (ov[field] != null) dtc[field] = ov[field];
        }
        dtc.vehicle_specific = true;
      }
    }

    // Generate YouTube search query
    const searchParts = [code];
    if (dtc.vehicle_specific && make && model) searchParts.push(make, model);
    searchParts.push(dtc.short_description, 'fix');
    dtc.youtube_search_query = searchParts.join(' ');

    res.json({ dtc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
