require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// ── Routes ──────────────────────────────────────────────────────────────────
const authRoutes          = require('./routes/auth');
const ordersRoutes        = require('./routes/orders');
const transactionsRoutes  = require('./routes/transactions');
const notificationsRoutes = require('./routes/notifications');
const usersRoutes         = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    'https://mydubaipartslink.netlify.app',
    'https://orderhub.netlify.app',
    'https://docship.netlify.app',
    // Add your custom domains here
    'http://localhost:3000',
    'http://localhost:5500',
    '*', // Remove this in production once you have real domains
  ],
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Accept'],
}));

// ── Rate limiting ────────────────────────────────────────────────────────────
const generalLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
});

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Apply rate limits ────────────────────────────────────────────────────────
app.use('/api', generalLimit);
app.use('/api/auth/login', authLimit);
app.use('/api/auth/register', authLimit);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'MyDubaiPartsLink API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/orders',        ordersRoutes);
app.use('/api/transactions',  transactionsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/users',         usersRoutes);

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   MyDubaiPartsLink API                    ║
  ║   Running on port ${PORT}                    ║
  ║   Environment: ${process.env.NODE_ENV || 'development'}              ║
  ╚═══════════════════════════════════════════╝
  `);
});

module.exports = app;
