require('dotenv').config();
const pool = require('./pool');

const migrations = `

-- ── USERS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(150) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  phone         VARCHAR(30) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  whatsapp      VARCHAR(30),
  country       VARCHAR(100) DEFAULT 'UAE',
  city          VARCHAR(100),
  avatar_url    VARCHAR(500),
  is_verified   BOOLEAN DEFAULT false,
  is_active     BOOLEAN DEFAULT true,
  role          VARCHAR(20) DEFAULT 'customer',   -- customer | admin
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── VEHICLES (saved by user) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_vehicles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type  VARCHAR(30) NOT NULL,
  make          VARCHAR(100) NOT NULL,
  model         VARCHAR(100) NOT NULL,
  year          VARCHAR(10) NOT NULL,
  chassis_vin   VARCHAR(20),
  nickname      VARCHAR(100),
  is_default    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── ORDERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               VARCHAR(20) UNIQUE NOT NULL,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Vehicle
  vehicle_type      VARCHAR(30),
  vehicle_make      VARCHAR(100),
  vehicle_model     VARCHAR(100),
  vehicle_year      VARCHAR(10),
  chassis_vin       VARCHAR(20),

  -- Part
  part_category     VARCHAR(50),
  part_category_name VARCHAR(100),
  part_details      TEXT,
  urgency           VARCHAR(20) DEFAULT 'standard',

  -- Logistics
  pickup_point      VARCHAR(50),
  pickup_point_name VARCHAR(150),
  courier_provider  VARCHAR(50),
  courier_name      VARCHAR(150),
  courier_mode      VARCHAR(10),   -- air | sea

  -- Payment
  pay_method        VARCHAR(30),
  deposit_pct       INTEGER DEFAULT 20,
  deposit_amount    DECIMAL(12,2),
  total_amount      DECIMAL(12,2),
  currency          VARCHAR(10) DEFAULT 'USD',

  -- Status
  status            VARCHAR(30) DEFAULT 'new',
  -- new | confirmed | sourcing | ready | dispatched | delivered | completed | cancelled

  -- WhatsApp
  wa_enabled        BOOLEAN DEFAULT true,
  wa_number         VARCHAR(30),

  -- Timestamps
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ,
  dispatched_at     TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ
);

-- ── ORDER STATUS HISTORY ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_status_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     VARCHAR(30) NOT NULL,
  note       TEXT,
  changed_by VARCHAR(100),   -- admin name or 'system'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TRANSACTIONS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  ref             VARCHAR(50) UNIQUE NOT NULL,

  type            VARCHAR(20) DEFAULT 'deposit',  -- deposit | balance | refund
  amount          DECIMAL(12,2) NOT NULL,
  currency        VARCHAR(10) DEFAULT 'USD',
  pay_method      VARCHAR(30) NOT NULL,

  status          VARCHAR(20) DEFAULT 'pending',
  -- pending | completed | failed | refunded

  external_ref    VARCHAR(100),  -- EcoCash / Paynow reference
  proof_url       VARCHAR(500),  -- uploaded proof image
  note            TEXT,
  processed_by    VARCHAR(100),

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── REFRESH TOKENS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(500) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── NOTIFICATIONS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  order_id   UUID REFERENCES orders(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  title      VARCHAR(200) NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_user_id     ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_ref          ON orders(ref);
CREATE INDEX IF NOT EXISTS idx_transactions_order  ON transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user   ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ── UPDATED_AT TRIGGER ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at    ON users;
DROP TRIGGER IF EXISTS trg_orders_updated_at   ON orders;
DROP TRIGGER IF EXISTS trg_txn_updated_at      ON transactions;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_txn_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
`;

async function migrate() {
  console.log('🔄 Running migrations...');
  const client = await pool.connect();
  try {
    await client.query(migrations);
    console.log('✅ All tables created successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
