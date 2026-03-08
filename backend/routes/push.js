const express = require('express');
const jwt     = require('jsonwebtoken');
const pool    = require('../config/db');
const router  = express.Router();

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

// PUT /api/push/token
// Register or refresh the Expo push token for the calling user's device.
// Body: { token: string, platform?: 'ios' | 'android' | 'web' }
//
// Idempotent: upserting on the token value means repeated calls from the
// same installation are safe. If the user logs out and another user logs in
// on the same device, the token's user_id is updated to the new user.
router.put('/token', authenticateToken, async (req, res) => {
  const { token, platform } = req.body;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ message: 'token is required' });
  }

  // Basic format check: Expo tokens look like ExponentPushToken[xxx]
  // or an FCM token for bare workflow. Accept anything non-empty but warn
  // if it doesn't match the Expo format so we catch mis-integrations early.
  const isExpoFormat = /^ExponentPushToken\[.+\]$/.test(token);
  if (!isExpoFormat) {
    console.warn(`[push] Unexpected token format for user ${req.userId}: ${token.slice(0, 40)}`);
  }

  try {
    await pool.query(
      `INSERT INTO device_push_tokens (user_id, token, platform, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (token) DO UPDATE
         SET user_id    = EXCLUDED.user_id,
             platform   = COALESCE(EXCLUDED.platform, device_push_tokens.platform),
             updated_at = NOW()`,
      [req.userId, token, platform ?? null]
    );
    res.json({ registered: true });
  } catch (err) {
    console.error('[push] token registration error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/push/token
// Unregister a push token (e.g. on logout so the user stops receiving alerts).
// Body: { token: string }
router.delete('/token', authenticateToken, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ message: 'token is required' });

  try {
    await pool.query(
      `DELETE FROM device_push_tokens WHERE token = $1 AND user_id = $2`,
      [token, req.userId]
    );
    res.json({ unregistered: true });
  } catch (err) {
    console.error('[push] token removal error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
