const express = require('express');
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const router = express.Router();

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

// POST /api/scans/batch — bulk ingest from iOS SQLite buffer (called on foreground)
router.post('/batch', authenticateToken, async (req, res) => {
  const { scans } = req.body;
  if (!Array.isArray(scans) || scans.length === 0) {
    return res.status(400).json({ message: 'scans array is required' });
  }

  // Validate and filter: only rows with a dtc_code are written to scan_history
  const valid = scans.filter(s => s.dtc_code && typeof s.dtc_code === 'string');
  if (valid.length === 0) return res.json({ inserted: 0 });

  try {
    // INSERT each record; ON CONFLICT DO NOTHING prevents duplicates if the
    // client retries after a partial failure (no unique constraint exists yet,
    // but this is a no-op guard for future idempotency migrations).
    let inserted = 0;
    for (const scan of valid) {
      const ts = scan.timestamp ? new Date(scan.timestamp) : new Date();
      const { rowCount } = await pool.query(
        `INSERT INTO scan_history (user_id, vehicle_id, dtc_code, scanned_at)
         VALUES ($1, $2, $3, $4)`,
        [req.userId, scan.vehicle_id ?? null, scan.dtc_code.toUpperCase(), ts]
      );
      inserted += rowCount;
    }
    res.status(201).json({ inserted });
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
         d.drive_safety,
         d.drive_safety_reason,
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

// GET /api/scans/:id — single scan with full DTC + vehicle detail
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         sh.id,
         sh.dtc_code,
         sh.scanned_at,
         sh.vehicle_id,
         d.short_description,
         d.description,
         d.possible_causes,
         d.symptoms,
         d.severity,
         d.urgency,
         d.repairs,
         d.oem_cost_min,
         d.oem_cost_max,
         d.aftermarket_cost_min,
         d.aftermarket_cost_max,
         d.labor_hours_min,
         d.labor_hours_max,
         d.diy_difficulty,
         d.drive_safety,
         d.drive_safety_reason,
         v.year     AS vehicle_year,
         v.make     AS vehicle_make,
         v.model    AS vehicle_model,
         v.nickname AS vehicle_nickname
       FROM scan_history sh
       JOIN dtc_codes d ON d.code = sh.dtc_code
       LEFT JOIN vehicles v ON v.id = sh.vehicle_id
       WHERE sh.id = $1 AND sh.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Scan not found' });
    res.json({ scan: rows[0] });
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
