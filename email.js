const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ── Order confirmation to customer ─────────────────────────────────────────
const sendOrderConfirmation = async (order, user) => {
  if (!process.env.EMAIL_USER) return;
  const subject = `Order Received — ${order.ref} | MyDubaiPartsLink`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8f9fa;padding:20px">
      <div style="background:linear-gradient(135deg,#5bbcde,#3aa8d8);padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:22px">🔧 MyDubaiPartsLink</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px">SPARE PARTS ORDERING</p>
      </div>
      <div style="background:#fff;padding:28px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
        <h2 style="color:#1a2a3a;margin:0 0 8px">Hi ${user.name} 👋</h2>
        <p style="color:#4a6a8a;margin:0 0 24px">Your spare parts order has been received. We'll contact you shortly with a quote and deposit details.</p>
        
        <div style="background:#f0f8fd;border:1px solid #b0daf0;border-radius:8px;padding:16px;margin-bottom:20px">
          <p style="margin:0 0 4px;font-size:11px;color:#3a7a9a;text-transform:uppercase;letter-spacing:0.8px">Order Reference</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:#c97318;letter-spacing:1.5px">${order.ref}</p>
        </div>

        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:13px;width:40%">Vehicle</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;color:#1a2a3a;font-size:13px;font-weight:500">${order.vehicle_make} ${order.vehicle_model} ${order.vehicle_year}</td></tr>
          ${order.chassis_vin ? `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:13px">Chassis / VIN</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;color:#1a2a3a;font-size:13px;font-weight:500;font-family:monospace">${order.chassis_vin}</td></tr>` : ''}
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:13px">Part Category</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;color:#1a2a3a;font-size:13px;font-weight:500">${order.part_category_name}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:13px">Part Details</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;color:#1a2a3a;font-size:13px;font-weight:500">${order.part_details}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:13px">Delivery Speed</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;color:#1a2a3a;font-size:13px;font-weight:500">${order.urgency === 'express' ? 'Express — 7 days' : order.urgency === 'urgent' ? 'Urgent — 2 weeks' : 'Standard — 1 month'}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;font-size:13px">Pickup Point</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;color:#1a2a3a;font-size:13px;font-weight:500">${order.pickup_point_name}</td></tr>
          <tr><td style="padding:8px 0;color:#888;font-size:13px">Courier</td>
              <td style="padding:8px 0;color:#1a2a3a;font-size:13px;font-weight:500">${order.courier_name} — ${order.courier_mode === 'air' ? '✈️ Air Cargo' : '🚢 Sea Cargo'}</td></tr>
        </table>

        <div style="background:#fff8ee;border:1px solid #f0d090;border-radius:8px;padding:14px;margin-top:20px">
          <p style="margin:0;font-size:13px;color:#7a5010">💳 A <strong>${order.deposit_pct}% deposit</strong> is required to confirm your order. Our team will send you the exact amount and payment details via WhatsApp and email shortly.</p>
        </div>

        <p style="margin:24px 0 0;font-size:13px;color:#888;text-align:center">Questions? Reply to this email or WhatsApp us directly.</p>
      </div>
    </div>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'MyDubaiPartsLink <noreply@mydubaipartslink.com>',
    to: user.email,
    subject,
    html,
  });
};

// ── New order alert to admin ────────────────────────────────────────────────
const sendAdminAlert = async (order, user) => {
  if (!process.env.EMAIL_USER) return;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#c97318">🔔 New Order — ${order.ref}</h2>
      <p><strong>Customer:</strong> ${user.name} (${user.email} | ${user.phone})</p>
      <p><strong>Vehicle:</strong> ${order.vehicle_make} ${order.vehicle_model} ${order.vehicle_year}</p>
      ${order.chassis_vin ? `<p><strong>VIN:</strong> ${order.chassis_vin}</p>` : ''}
      <p><strong>Part:</strong> ${order.part_category_name} — ${order.part_details}</p>
      <p><strong>Urgency:</strong> ${order.urgency}</p>
      <p><strong>Pickup:</strong> ${order.pickup_point_name}</p>
      <p><strong>Courier:</strong> ${order.courier_name} / ${order.courier_mode}</p>
      <p><strong>Payment:</strong> ${order.pay_method}</p>
      <p style="color:#888;font-size:12px">Submitted: ${new Date(order.created_at).toLocaleString()}</p>
    </div>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_USER,
    subject: `🔔 New Order ${order.ref} — ${user.name}`,
    html,
  });
};

// ── Status update to customer ───────────────────────────────────────────────
const sendStatusUpdate = async (order, user, status, note) => {
  if (!process.env.EMAIL_USER) return;
  const statusMessages = {
    confirmed:  { emoji: '✅', title: 'Order Confirmed', msg: 'Your order has been confirmed. Please proceed with your deposit payment.' },
    sourcing:   { emoji: '🔍', title: 'Sourcing Your Part', msg: 'Our team is actively sourcing your part from suppliers.' },
    ready:      { emoji: '📦', title: 'Part Ready for Pickup', msg: 'Your part has arrived and is ready for collection at your chosen pickup point.' },
    dispatched: { emoji: '🚚', title: 'Out for Delivery', msg: 'Your order is on its way! Our driver will contact you shortly.' },
    delivered:  { emoji: '🎉', title: 'Order Delivered', msg: 'Your order has been delivered. Thank you for choosing MyDubaiPartsLink!' },
    cancelled:  { emoji: '❌', title: 'Order Cancelled', msg: 'Your order has been cancelled. Please contact us for a refund if payment was made.' },
  };

  const info = statusMessages[status] || { emoji: '📋', title: 'Order Update', msg: 'Your order status has been updated.' };

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8f9fa;padding:20px">
      <div style="background:linear-gradient(135deg,#5bbcde,#3aa8d8);padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:20px">🔧 MyDubaiPartsLink</h1>
      </div>
      <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px">
        <h2 style="margin:0 0 8px;font-size:24px">${info.emoji} ${info.title}</h2>
        <p style="color:#4a6a8a">Hi ${user.name}, ${info.msg}</p>
        ${note ? `<div style="background:#f0f8fd;border-radius:8px;padding:12px;margin:16px 0"><p style="margin:0;font-size:13px;color:#2a5a7a">${note}</p></div>` : ''}
        <p style="font-size:13px;color:#888">Order Reference: <strong style="color:#c97318">${order.ref}</strong></p>
      </div>
    </div>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: `${info.emoji} ${info.title} — ${order.ref}`,
    html,
  });
};

// ── Password reset ──────────────────────────────────────────────────────────
const sendPasswordReset = async (user, resetToken) => {
  if (!process.env.EMAIL_USER) return;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2>🔐 Password Reset — MyDubaiPartsLink</h2>
      <p>Hi ${user.name},</p>
      <p>You requested a password reset. Use the code below (valid for 1 hour):</p>
      <div style="background:#f0f8fd;border-radius:8px;padding:20px;text-align:center;margin:20px 0">
        <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#c97318;margin:0">${resetToken}</p>
      </div>
      <p style="color:#888;font-size:13px">If you didn't request this, ignore this email. Your password won't change.</p>
    </div>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: '🔐 Password Reset Code — MyDubaiPartsLink',
    html,
  });
};

module.exports = { sendOrderConfirmation, sendAdminAlert, sendStatusUpdate, sendPasswordReset };
