const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /users — Admin: list all users ─────────────────────────────────────
router.get('/', authenticate, requireAdmin, async (req, res) => {
  const { page = 1, limit = 50, search } = req.query;
  const offset = (page - 1) * limit;

  try {
    let where = 'WHERE 1=1';
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1)`;
    }

    params.push(limit, offset);
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.phone, u.country, u.city,
             u.role, u.is_active, u.last_login, u.created_at,
             COUNT(o.id) as order_count
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      ${where}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ── GET /users/:id — Admin: get single user with orders ────────────────────
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, name, email, phone, whatsapp, city, country, role, is_active, last_login, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

    const orders = await pool.query(
      'SELECT ref, part_category_name, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [req.params.id]
    );

    res.json({ user: user.rows[0], recentOrders: orders.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ── PATCH /users/:id/status — Admin: activate/deactivate ───────────────────
router.patch('/:id/status', authenticate, requireAdmin, async (req, res) => {
  const { is_active } = req.body;
  try {
    await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [is_active, req.params.id]);
    res.json({ message: `User ${is_active ? 'activated' : 'deactivated'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ── GET /users/me/vehicles — Saved vehicles ─────────────────────────────────
router.get('/me/vehicles', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM user_vehicles WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [req.user.id]
    );
    res.json({ vehicles: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

// ── POST /users/me/vehicles — Save a vehicle ────────────────────────────────
router.post('/me/vehicles', authenticate, async (req, res) => {
  const { vehicleType, make, model, year, chassisVin, nickname, isDefault } = req.body;
  try {
    if (isDefault) {
      await pool.query('UPDATE user_vehicles SET is_default = false WHERE user_id = $1', [req.user.id]);
    }
    const { rows } = await pool.query(`
      INSERT INTO user_vehicles (user_id, vehicle_type, make, model, year, chassis_vin, nickname, is_default)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [req.user.id, vehicleType, make, model, year, chassisVin || null, nickname || null, isDefault || false]);
    res.status(201).json({ vehicle: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save vehicle' });
  }
});

// ── DELETE /users/me/vehicles/:id ───────────────────────────────────────────
router.delete('/me/vehicles/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_vehicles WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Vehicle removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove vehicle' });
  }
});

module.exports = router;
