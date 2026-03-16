const express = require('express');
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const { validateVehicle } = require('../middleware/validate');
const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM vehicles WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json({ vehicles: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', authenticateToken, validateVehicle, async (req, res) => {
  const { year, make, model, trim, mileage } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO vehicles (user_id, year, make, model, trim, mileage) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.userId, year, make, model, trim || null, mileage || null]
    );
    res.json({ vehicle: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.params.id, 10);
  const { nickname, mileage, year, make, model, vin, is_active } = req.body;

  try {
    // Ownership check
    const owns = await pool.query(
      'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2',
      [vehicleId, req.userId]
    );
    if (owns.rows.length === 0)
      return res.status(404).json({ message: 'Vehicle not found' });

    // Validate provided fields
    if (mileage !== undefined && (typeof mileage !== 'number' || mileage < 0))
      return res.status(400).json({ message: 'mileage must be a non-negative number' });

    const currentYear = new Date().getFullYear();
    if (year !== undefined && (year < 1900 || year > currentYear + 1))
      return res.status(400).json({ message: `year must be between 1900 and ${currentYear + 1}` });

    if (vin !== undefined && vin !== null && vin.length !== 17)
      return res.status(400).json({ message: 'VIN must be exactly 17 characters' });

    if (vin) {
      const vinConflict = await pool.query(
        'SELECT id FROM vehicles WHERE vin = $1 AND id != $2',
        [vin.toUpperCase(), vehicleId]
      );
      if (vinConflict.rows.length > 0)
        return res.status(400).json({ message: 'VIN already registered to another vehicle' });
    }

    // Build dynamic SET clause
    const allowed = { nickname, mileage, year, make, model, vin: vin ? vin.toUpperCase() : vin, is_active };
    const setClauses = [];
    const params = [];

    for (const [col, val] of Object.entries(allowed)) {
      if (val !== undefined) {
        params.push(val);
        setClauses.push(`${col} = $${params.length}`);
      }
    }

    if (setClauses.length === 0)
      return res.status(400).json({ message: 'No valid fields provided' });

    setClauses.push(`updated_at = NOW()`);
    params.push(vehicleId);

    const result = await pool.query(
      `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ vehicle: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM vehicles WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    res.json({ message: 'Vehicle deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;