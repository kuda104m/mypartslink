const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const genTxnRef = () => 'TXN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

// ── GET /transactions — User's transaction history ──────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const { rows } = await pool.query(`
      SELECT t.*, o.ref as order_ref, o.part_category_name, o.vehicle_make, o.vehicle_model
      FROM transactions t
      JOIN orders o ON o.id = t.order_id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);

    const countRes = await pool.query(
      'SELECT COUNT(*), SUM(amount) FILTER (WHERE status = $1) as total_paid FROM transactions WHERE user_id = $2',
      ['completed', req.user.id]
    );

    res.json({
      transactions: rows,
      total: parseInt(countRes.rows[0].count),
      totalPaid: parseFloat(countRes.rows[0].total_paid || 0),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ── POST /transactions — Record a payment (admin confirms) ──────────────────
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { orderId, type, amount, currency, payMethod, externalRef, note } = req.body;

  if (!orderId || !amount || !payMethod) {
    return res.status(400).json({ error: 'orderId, amount and payMethod required' });
  }

  try {
    // Get order and user
    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (!orderRes.rows.length) return res.status(404).json({ error: 'Order not found' });

    const order = orderRes.rows[0];
    const ref = genTxnRef();

    const { rows } = await pool.query(`
      INSERT INTO transactions (order_id, user_id, ref, type, amount, currency, pay_method, status, external_ref, note, processed_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9, $10)
      RETURNING *
    `, [order.id, order.user_id, ref, type || 'deposit', amount, currency || 'USD', payMethod, externalRef || null, note || null, req.user.name]);

    // Notify user
    if (order.user_id) {
      await pool.query(`
        INSERT INTO notifications (user_id, order_id, type, title, message)
        VALUES ($1, $2, 'payment_received', $3, $4)
      `, [order.user_id, order.id,
        `Payment received — ${order.ref}`,
        `Your ${type || 'deposit'} payment of ${currency || 'USD'} ${amount} has been received.`
      ]);
    }

    res.status(201).json({ message: 'Transaction recorded', transaction: rows[0] });
  } catch (err) {
    console.error('Transaction error:', err);
    res.status(500).json({ error: 'Failed to record transaction' });
  }
});

// ── GET /transactions/admin/all ─────────────────────────────────────────────
router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const { rows } = await pool.query(`
      SELECT t.*, o.ref as order_ref, u.name as customer_name, u.email as customer_email
      FROM transactions t
      JOIN orders o ON o.id = t.order_id
      LEFT JOIN users u ON u.id = t.user_id
      ORDER BY t.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const summary = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(amount) FILTER (WHERE status = 'completed') as total_collected,
        SUM(amount) FILTER (WHERE status = 'pending') as total_pending,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_count
      FROM transactions
    `);

    res.json({ transactions: rows, summary: summary.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

module.exports = router;
