const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const { sendEmail } = require('../utils/email');

const router = express.Router();

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Too many requests. Try again later.' },
  standardHeaders: true, legacyHeaders: false,
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
});

function generateCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const { email } = req.body || {};
  const generic = { message: 'If an account exists for that email, a reset code has been sent.' };

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );
    if (userResult.rows.length === 0) return res.status(200).json(generic);

    const user = userResult.rows[0];
    const code = generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      'UPDATE password_reset_codes SET used = TRUE WHERE user_id = $1 AND used = FALSE',
      [user.id]
    );
    await pool.query(
      'INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, codeHash, expiresAt]
    );

    await sendEmail({
      to: user.email,
      subject: 'Your ODIN AutoAlert password reset code',
      text: `Your password reset code is ${code}. It expires in 15 minutes. If you didn't request this, you can safely ignore this email.`,
      html: `
        <div style="background:#080808;color:#E0E0E0;padding:32px;font-family:monospace;">
          <h2 style="color:#C0C0C0;letter-spacing:3px;">ODIN AUTOALERT</h2>
          <p>Your password reset code is:</p>
          <h1 style="color:#E8A838;font-size:48px;letter-spacing:8px;">${code}</h1>
          <p style="color:#777;">This code expires in 15 minutes.</p>
          <p style="color:#555;font-size:11px;">If you did not request a password reset, you can safely ignore this email.</p>
        </div>
      `,
    });

    return res.status(200).json(generic);
  } catch (err) {
    console.error('forgot-password error', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/reset-password', resetLimiter, async (req, res) => {
  const { email, code, newPassword } = req.body || {};

  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, code, and new password are required.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const userResult = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid code or email.' });
    }
    const user = userResult.rows[0];

    const codeResult = await pool.query(
      `SELECT id, code_hash FROM password_reset_codes
       WHERE user_id = $1 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    if (codeResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }
    const record = codeResult.rows[0];

    const match = await bcrypt.compare(String(code), record.code_hash);
    if (!match) return res.status(400).json({ error: 'Invalid or expired code.' });

    const newHash = await bcrypt.hash(String(newPassword), 12);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, user.id]);
    await pool.query('UPDATE password_reset_codes SET used = TRUE WHERE id = $1', [record.id]);

    return res.status(200).json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    console.error('reset-password error', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

module.exports = router;
