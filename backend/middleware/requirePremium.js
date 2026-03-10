'use strict';

const pool = require('../config/db');

/**
 * requirePremium — must run after authenticateToken (needs req.userId).
 * Returns 403 with premium_required: true if the user is not on a premium plan.
 */
module.exports = async function requirePremium(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT is_premium FROM users WHERE id = $1',
      [req.userId]
    );
    if (!rows[0]?.is_premium) {
      return res.status(403).json({
        message: 'Premium subscription required',
        premium_required: true,
      });
    }
    next();
  } catch (err) {
    console.error('[requirePremium]', err);
    res.status(500).json({ message: 'Server error' });
  }
};
