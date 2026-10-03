const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { sendPasswordReset } = require('../utils/email');

const router = express.Router();

// ── Generate tokens ─────────────────────────────────────────────────────────
const generateAccessToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });

const generateRefreshToken = () => uuidv4() + '-' + uuidv4();

// ── POST /auth/register ─────────────────────────────────────────────────────
router.post('/register', [
  body('name').trim().isLength({ min: 2, max: 150 }).withMessage('Name must be 2–150 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('phone').trim().isLength({ min: 7, max: 20 }).withMessage('Valid phone required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, email, phone, password, whatsapp, city, country } = req.body;

  try {
    // Check email not taken
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email already registered. Please login.' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(`
      INSERT INTO users (name, email, phone, password_hash, whatsapp, city, country)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, email, phone, whatsapp, city, country, role, created_at
    `, [name, email, phone, password_hash, whatsapp || phone, city || '', country || 'UAE']);

    const user = rows[0];

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken();

    // Save refresh token
    await pool.query(`
      INSERT INTO refresh_tokens (user_id, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '90 days')
    `, [user.id, refreshToken]);

    // Update last login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.status(201).json({
      message: 'Account created successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        whatsapp: user.whatsapp,
        role: user.role,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── POST /auth/login ────────────────────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken();

    // Save refresh token
    await pool.query(`
      INSERT INTO refresh_tokens (user_id, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '90 days')
    `, [user.id, refreshToken]);

    // Update last login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        whatsapp: user.whatsapp,
        city: user.city,
        country: user.country,
        role: user.role,
        last_login: user.last_login,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── POST /auth/refresh ──────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    const { rows } = await pool.query(`
      SELECT rt.*, u.id as uid, u.is_active
      FROM refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      WHERE rt.token = $1 AND rt.expires_at > NOW()
    `, [refreshToken]);

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const newAccessToken = generateAccessToken(rows[0].uid);
    res.json({ accessToken: newAccessToken });
  } catch (err) {
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// ── POST /auth/logout ───────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  const { refreshToken } = req.body;
  try {
    if (refreshToken) {
      await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    // Delete all refresh tokens for this user (full logout from all devices)
    if (req.body.allDevices) {
      await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ── GET /auth/me ────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, email, phone, whatsapp, city, country, role, 
             is_verified, avatar_url, last_login, created_at
      FROM users WHERE id = $1
    `, [req.user.id]);

    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    // Get order stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled')) as active
      FROM orders WHERE user_id = $1
    `, [req.user.id]);

    res.json({
      user: rows[0],
      stats: stats.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// ── PUT /auth/profile ───────────────────────────────────────────────────────
router.put('/profile', authenticate, [
  body('name').optional().trim().isLength({ min: 2, max: 150 }),
  body('phone').optional().trim().isLength({ min: 7, max: 20 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, phone, whatsapp, city, country } = req.body;

  try {
    const { rows } = await pool.query(`
      UPDATE users SET
        name      = COALESCE($1, name),
        phone     = COALESCE($2, phone),
        whatsapp  = COALESCE($3, whatsapp),
        city      = COALESCE($4, city),
        country   = COALESCE($5, country)
      WHERE id = $6
      RETURNING id, name, email, phone, whatsapp, city, country
    `, [name, phone, whatsapp, city, country, req.user.id]);

    res.json({ message: 'Profile updated', user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// ── PUT /auth/change-password ───────────────────────────────────────────────
router.put('/change-password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { currentPassword, newPassword } = req.body;

  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(400).json({ error: 'Current password incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    // Invalidate all refresh tokens
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);

    res.json({ message: 'Password changed. Please login again.' });
  } catch (err) {
    res.status(500).json({ error: 'Password change failed' });
  }
});

// ── POST /auth/forgot-password ──────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    // Always respond OK (don't reveal if email exists)
    if (!rows.length) return res.json({ message: 'If that email exists, a reset code was sent.' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const hash = await bcrypt.hash(code, 8);

    // Store reset code temporarily (expires 1hr) — re-use refresh_tokens table
    await pool.query(`
      INSERT INTO refresh_tokens (user_id, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '1 hour')
    `, [rows[0].id, 'RESET:' + hash]);

    await sendPasswordReset(rows[0], code);
    res.json({ message: 'If that email exists, a reset code was sent.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

// ── POST /auth/reset-password ───────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, code and new password required' });
  }

  try {
    const { rows: users } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!users.length) return res.status(400).json({ error: 'Invalid request' });

    const { rows: tokens } = await pool.query(`
      SELECT * FROM refresh_tokens
      WHERE user_id = $1 AND token LIKE 'RESET:%' AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 5
    `, [users[0].id]);

    let valid = false;
    for (const t of tokens) {
      const hash = t.token.replace('RESET:', '');
      if (await bcrypt.compare(code, hash)) { valid = true; break; }
    }

    if (!valid) return res.status(400).json({ error: 'Invalid or expired reset code' });

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, users[0].id]);
    await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1 AND token LIKE 'RESET:%'", [users[0].id]);

    res.json({ message: 'Password reset successfully. Please login.' });
  } catch (err) {
    res.status(500).json({ error: 'Password reset failed' });
  }
});

module.exports = router;
