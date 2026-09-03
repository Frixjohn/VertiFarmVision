-- ═══════════════════════════════════════════════════════════════════
--  farmdash · PostgreSQL Schema
--  Run with:  psql -U postgres -d farmdash -f schema.sql
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. USERS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) UNIQUE NOT NULL,
  password   VARCHAR(255)        NOT NULL,
  created_at TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- ── 2. NODES ─────────────────────────────────────────────────────────
--  node_id  = string sent by ESP32, e.g. "NODE-01"
--  id       = numeric PK used by all other tables
CREATE TABLE IF NOT EXISTS nodes (
  id                SERIAL PRIMARY KEY,
  node_id           VARCHAR(50)  UNIQUE NOT NULL,
  name              VARCHAR(100),
  layer_number      INTEGER             DEFAULT 1,
  temperature       NUMERIC(5,2),
  humidity          NUMERIC(5,2),
  soil_moisture     NUMERIC(5,2),
  soil_ph           NUMERIC(4,2),
  lux               NUMERIC(8,2),
  irrigation_status VARCHAR(20)         DEFAULT 'idle',
  last_irrigation   TIMESTAMPTZ,
  is_active         BOOLEAN             DEFAULT TRUE,
  updated_at        TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- ── 3. SENSOR READINGS ───────────────────────────────────────────────
--  node_id here is the STRING (e.g. "NODE-01"), not the numeric id.
--  server.js inserts directly with the ESP32 node_id string.
CREATE TABLE IF NOT EXISTS sensor_readings (
  id            SERIAL PRIMARY KEY,
  node_id       VARCHAR(50)  NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
  temperature   NUMERIC(5,2),
  humidity      NUMERIC(5,2),
  soil_moisture NUMERIC(5,2),
  soil_ph       NUMERIC(4,2),
  lux           NUMERIC(8,2),
  recorded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 4. IRRIGATION LOG ────────────────────────────────────────────────
--  node_id here is the NUMERIC PK from nodes.id.
--  server.js irrigate route inserts req.params.id (numeric).
CREATE TABLE IF NOT EXISTS irrigation_log (
  id           SERIAL PRIMARY KEY,
  node_id      INTEGER     NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  triggered_by VARCHAR(50)          DEFAULT 'manual',
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. AFLC DECISIONS ────────────────────────────────────────────────
--  node_id here is the NUMERIC PK from nodes.id.
CREATE TABLE IF NOT EXISTS aflc_decisions (
  id         SERIAL PRIMARY KEY,
  node_id    INTEGER      NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  decision   VARCHAR(20),                 -- 'IRRIGATE' | 'MONITOR' | 'OPTIMAL'
  confidence NUMERIC(5,2),
  reason     TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── SEED: default admin user ─────────────────────────────────────────
--  Password: admin123  (bcrypt hash — change after first login)
INSERT INTO users (email, password)
VALUES ('admin@farmdash.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lF7W')
ON CONFLICT (email) DO NOTHING;

-- ── SEED: two default nodes (matches ESP32 NODE-01 / NODE-02) ────────
INSERT INTO nodes (node_id, name, layer_number)
VALUES
  ('NODE-01', 'NODE-01', 1),
  ('NODE-02', 'NODE-02', 2)
ON CONFLICT (node_id) DO NOTHING;

-- ── MIGRATION: add lux column if upgrading existing DB ───────────────
ALTER TABLE nodes            ADD COLUMN IF NOT EXISTS lux NUMERIC(8,2);
ALTER TABLE sensor_readings  ADD COLUMN IF NOT EXISTS lux NUMERIC(8,2);
