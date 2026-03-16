// Data deletion endpoints (GDPR/CCPA readiness)
const express = require('express');
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// DELETE /api/user/data — wipe all personal data for the authenticated user.
// Leaves the user account in place. Call DELETE /api/user/account to fully remove.
router.delete('/data', authenticateToken, async (req, res) => {
  const userId = req.userId;
  try {
    await pool.query('DELETE FROM scan_history   WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM vehicles       WHERE user_id = $1', [userId]);
    res.json({ message: 'User data deleted.' });
  } catch (err) {
    console.error('Data deletion error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/user/account — full account removal (data + user row).
router.delete('/account', authenticateToken, async (req, res) => {
  const userId = req.userId;
  try {
    // Cascades handle scan_history, refresh_tokens via FK ON DELETE CASCADE
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ message: 'Account deleted.' });
  } catch (err) {
    console.error('Account deletion error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
