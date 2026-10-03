const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');
const { sendOrderConfirmation, sendAdminAlert, sendStatusUpdate } = require('../utils/email');

const router = express.Router();

// ── Generate order ref ──────────────────────────────────────────────────────
const genRef = () => 'MDPL-' + Math.random().toString(36).substring(2, 8).toUpperCase();

const calcDepositPct = (urgency) => ({ express: 50, urgent: 30, standard: 20 }[urgency] || 20);

// ── POST /orders — Create new order ────────────────────────────────────────
router.post('/', optionalAuth, [
  body('vehicleType').notEmpty(),
  body('vehicleMake').notEmpty(),
  body('vehicleModel').notEmpty(),
  body('vehicleYear').notEmpty(),
  body('partCategory').notEmpty(),
  body('partDetails').isLength({ min: 3 }),
  body('customerName').notEmpty(),
  body('customerPhone').notEmpty(),
  body('customerEmail').isEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    vehicleType, vehicleMake, vehicleModel, vehicleYear, chassisNumber,
    partCategory, partCategoryName, partDetails, urgency,
    pickupPoint, pickupPointName, courierProvider, courierName, courierMode,
    payMethod, depositPct, depositAmount, totalAmount,
    customerName, customerPhone, customerEmail,
    waEnabled, waNumber,
  } = req.body;

  const ref = genRef();
  const deposit_pct = depositPct || calcDepositPct(urgency);
  const user_id = req.user?.id || null;

  try {
    // If guest (no account), create a temporary user record or just store as guest
    let resolvedUserId = user_id;

    if (!resolvedUserId) {
      // Check if email already has an account
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [customerEmail]);
      if (existing.rows.length) {
        resolvedUserId = existing.rows[0].id;
      }
      // If no account, order is stored as guest (user_id = null)
    }

    const { rows } = await pool.query(`
      INSERT INTO orders (
        ref, user_id,
        vehicle_type, vehicle_make, vehicle_model, vehicle_year, chassis_vin,
        part_category, part_category_name, part_details, urgency,
        pickup_point, pickup_point_name,
        courier_provider, courier_name, courier_mode,
        pay_method, deposit_pct, deposit_amount, total_amount,
        wa_enabled, wa_number
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      )
      RETURNING *
    `, [
      ref, resolvedUserId,
      vehicleType, vehicleMake, vehicleModel, vehicleYear, chassisNumber || null,
      partCategory, partCategoryName || partCategory, partDetails, urgency || 'standard',
      pickupPoint, pickupPointName || pickupPoint,
      courierProvider, courierName || courierProvider, courierMode,
      payMethod, deposit_pct, depositAmount || null, totalAmount || null,
      waEnabled !== false, waNumber || customerPhone,
    ]);

    const order = rows[0];

    // Log initial status
    await pool.query(`
      INSERT INTO order_status_history (order_id, status, changed_by)
      VALUES ($1, 'new', 'customer')
    `, [order.id]);

    // Create notification for logged-in user
    if (resolvedUserId) {
      await pool.query(`
        INSERT INTO notifications (user_id, order_id, type, title, message)
        VALUES ($1, $2, 'order_placed', $3, $4)
      `, [resolvedUserId, order.id,
        `Order ${ref} placed`,
        `Your order for ${partCategoryName || partCategory} has been received.`
      ]);
    }

    // Send emails
    const customer = {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
    };

    try { await sendOrderConfirmation(order, customer); } catch (e) { console.error('Email error:', e.message); }
    try { await sendAdminAlert(order, customer); } catch (e) { console.error('Admin email error:', e.message); }

    res.status(201).json({
      message: 'Order submitted successfully',
      order: {
        id: order.id,
        ref: order.ref,
        status: order.status,
        created_at: order.created_at,
      },
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Failed to create order. Please try again.' });
  }
});

// ── GET /orders — List orders for logged-in user ────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = `
      SELECT id, ref, vehicle_make, vehicle_model, vehicle_year,
             part_category_name, part_details, urgency, status,
             courier_name, courier_mode, pickup_point_name,
             pay_method, deposit_pct, deposit_amount, total_amount,
             created_at, updated_at, confirmed_at, dispatched_at, delivered_at
      FROM orders
      WHERE user_id = $1
    `;
    const params = [req.user.id];

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Total count
    const countRes = await pool.query(
      'SELECT COUNT(*) FROM orders WHERE user_id = $1' + (status ? ' AND status = $2' : ''),
      status ? [req.user.id, status] : [req.user.id]
    );

    res.json({
      orders: rows,
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page),
      pages: Math.ceil(parseInt(countRes.rows[0].count) / limit),
    });
  } catch (err) {
    console.error('List orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ── GET /orders/:ref — Get single order by ref ──────────────────────────────
router.get('/:ref', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT o.*,
             json_agg(
               json_build_object(
                 'status', osh.status,
                 'note', osh.note,
                 'changed_by', osh.changed_by,
                 'created_at', osh.created_at
               ) ORDER BY osh.created_at
             ) as history
      FROM orders o
      LEFT JOIN order_status_history osh ON osh.order_id = o.id
      WHERE o.ref = $1 AND (o.user_id = $2 OR $3 = 'admin')
      GROUP BY o.id
    `, [req.params.ref, req.user.id, req.user.role]);

    if (!rows.length) return res.status(404).json({ error: 'Order not found' });

    // Get transactions for this order
    const txns = await pool.query(`
      SELECT id, ref, type, amount, currency, pay_method, status, external_ref, created_at
      FROM transactions WHERE order_id = $1 ORDER BY created_at DESC
    `, [rows[0].id]);

    res.json({
      order: rows[0],
      transactions: txns.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// ── PATCH /orders/:ref/status — Admin: update order status ─────────────────
router.patch('/:ref/status', authenticate, requireAdmin, async (req, res) => {
  const { status, note } = req.body;

  const validStatuses = ['new','confirmed','sourcing','ready','dispatched','delivered','completed','cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const timestampField = {
      confirmed: 'confirmed_at',
      dispatched: 'dispatched_at',
      delivered: 'delivered_at',
    }[status];

    let updateQuery = 'UPDATE orders SET status = $1';
    const params = [status];

    if (timestampField) {
      updateQuery += `, ${timestampField} = NOW()`;
    }

    updateQuery += ' WHERE ref = $2 RETURNING *, (SELECT email FROM users WHERE id = orders.user_id) as user_email, (SELECT name FROM users WHERE id = orders.user_id) as user_name';
    params.push(req.params.ref);

    const { rows } = await pool.query(updateQuery, params);
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });

    const order = rows[0];

    // Log status change
    await pool.query(`
      INSERT INTO order_status_history (order_id, status, note, changed_by)
      VALUES ($1, $2, $3, $4)
    `, [order.id, status, note || null, req.user.name]);

    // Notify user
    if (order.user_id) {
      await pool.query(`
        INSERT INTO notifications (user_id, order_id, type, title, message)
        VALUES ($1, $2, $3, $4, $5)
      `, [order.user_id, order.id, `status_${status}`,
        `Order ${order.ref} — ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        note || `Your order status has been updated to ${status}.`
      ]);
    }

    // Send email
    if (order.user_email) {
      try {
        await sendStatusUpdate(order, { name: order.user_name, email: order.user_email }, status, note);
      } catch (e) { console.error('Status email error:', e.message); }
    }

    res.json({ message: 'Status updated', order: { ref: order.ref, status: order.status } });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ── GET /orders/admin/all — Admin: get all orders ───────────────────────────
router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
  const { page = 1, limit = 50, status, search } = req.query;
  const offset = (page - 1) * limit;

  try {
    let where = 'WHERE 1=1';
    const params = [];

    if (status) { params.push(status); where += ` AND o.status = $${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (o.ref ILIKE $${params.length} OR u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.phone ILIKE $${params.length})`;
    }

    params.push(limit, offset);
    const { rows } = await pool.query(`
      SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      ${where}
      ORDER BY o.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const countParams = params.slice(0, -2);
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM orders o LEFT JOIN users u ON u.id = o.user_id ${where}`,
      countParams
    );

    // Stats
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'new') as new_orders,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
        COUNT(*) FILTER (WHERE status = 'ready') as ready,
        COUNT(*) FILTER (WHERE status = 'dispatched') as dispatched,
        COUNT(*) FILTER (WHERE status = 'completed') as completed
      FROM orders
    `);

    res.json({
      orders: rows,
      total: parseInt(countRes.rows[0].count),
      stats: stats.rows[0],
      page: parseInt(page),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

module.exports = router;
