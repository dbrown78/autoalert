const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../middleware/validate');

const router = express.Router();

// ── Email helper ──────────────────────────────────────────────────────────────

function createTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

async function sendVerificationEmail(email, code) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[auth] EMAIL_USER/EMAIL_PASS not set — skipping email send. Code:', code);
    return;
  }
  await transporter.sendMail({
    from: '"AutoAlert by ODIN" <support@odinai.app>',
    to: email,
    subject: 'Verify your AutoAlert account',
    html: `
      <div style="background:#080808;color:#E0E0E0;padding:32px;font-family:monospace;">
        <h2 style="color:#4CAF82;letter-spacing:3px;">AUTOALERT</h2>
        <p>Your verification code is:</p>
        <h1 style="color:#E8A838;font-size:48px;letter-spacing:8px;">${code}</h1>
        <p style="color:#777;">This code expires in 24 hours.</p>
        <p style="color:#555;font-size:11px;">If you did not create an AutoAlert account, you can ignore this email.</p>
      </div>
    `,
  });
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function issueTokens(userId) {
  const accessToken = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: '15m', algorithm: 'HS256' }
  );
  const refreshToken = jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' }
  );
  return { accessToken, refreshToken };
}

async function storeRefreshToken(userId, token) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
}

// ── Register ──────────────────────────────────────────────────────────────────

router.post('/register', validateRegister, async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0)
      return res.status(400).json({ message: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, is_premium',
      [name, email, hash]
    );
    const user = result.rows[0];

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      'UPDATE users SET verification_code = $1, verification_expires_at = $2 WHERE id = $3',
      [verificationCode, expiresAt, user.id]
    );

    await sendVerificationEmail(email, verificationCode);

    res.status(201).json({ message: 'Verification email sent', requiresVerification: true, email });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Verify Email ──────────────────────────────────────────────────────────────

router.post('/verify-email', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code)
    return res.status(400).json({ error: 'Email and code are required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.email_verified) return res.status(400).json({ error: 'Already verified' });
    if (user.verification_code !== code) return res.status(400).json({ error: 'Invalid code' });
    if (new Date() > new Date(user.verification_expires_at)) {
      return res.status(400).json({ error: 'Code expired — request a new one' });
    }

    await pool.query(
      'UPDATE users SET email_verified = TRUE, verification_code = NULL, verification_expires_at = NULL WHERE id = $1',
      [user.id]
    );

    const { accessToken, refreshToken } = issueTokens(user.id);
    await storeRefreshToken(user.id, refreshToken);

    res.json({
      token: accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, is_premium: user.is_premium },
    });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Resend Verification ───────────────────────────────────────────────────────

router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.email_verified) return res.status(400).json({ error: 'Already verified' });

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      'UPDATE users SET verification_code = $1, verification_expires_at = $2 WHERE id = $3',
      [verificationCode, expiresAt, user.id]
    );

    await sendVerificationEmail(email, verificationCode);
    res.json({ message: 'Verification email sent' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', validateLogin, async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0)
      return res.status(400).json({ message: 'Invalid credentials' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ message: 'Invalid credentials' });

    if (!user.email_verified) {
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await pool.query(
        'UPDATE users SET verification_code = $1, verification_expires_at = $2 WHERE id = $3',
        [verificationCode, expiresAt, user.id]
      );
      await sendVerificationEmail(user.email, verificationCode);
      return res.status(403).json({
        error: 'Email not verified',
        requiresVerification: true,
        email: user.email,
      });
    }

    const { accessToken, refreshToken } = issueTokens(user.id);
    await storeRefreshToken(user.id, refreshToken);

    res.json({
      user: { id: user.id, name: user.name, email: user.email, is_premium: user.is_premium },
      token: accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Refresh ───────────────────────────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ message: 'Refresh token required' });

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });

    const stored = await pool.query(
      'SELECT id FROM refresh_tokens WHERE token = $1 AND user_id = $2 AND expires_at > NOW()',
      [refreshToken, decoded.id]
    );
    if (stored.rows.length === 0) return res.status(401).json({ message: 'Invalid or expired refresh token' });

    await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

    const { accessToken, refreshToken: newRefreshToken } = issueTokens(decoded.id);
    await storeRefreshToken(decoded.id, newRefreshToken);

    res.json({ token: accessToken, refreshToken: newRefreshToken });
  } catch {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', authenticateToken, async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await pool.query(
      'DELETE FROM refresh_tokens WHERE token = $1 AND user_id = $2',
      [refreshToken, req.userId]
    ).catch(() => {});
  }
  res.json({ message: 'Logged out' });
});

// ── Me ────────────────────────────────────────────────────────────────────────

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, is_premium FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Delete Account ────────────────────────────────────────────────────────────

router.delete('/account', authenticateToken, async (req, res) => {
  const userId = req.userId;
  try {
    await pool.query('DELETE FROM scans WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM vehicles WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('Account deletion error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
