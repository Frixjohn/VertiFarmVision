/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXPRESS BACKEND — server.js
 * farmdash · PostgreSQL
 *
 * Install:
 *   npm install express pg cors dotenv bcryptjs jsonwebtoken ws
 *
 * Requires Node.js 18+ (native fetch + AbortSignal.timeout for the ML/AFLC calls)
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
<<<<<<< HEAD
const http = require('http');
require('dotenv').config();
=======
const http       = require('http');
const fs         = require('fs');
const path       = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
>>>>>>> 77b06f8b77062746943518069c3ce17d1a8e9f67

const app = express();
const server = http.createServer(app);

// Disable automatic ETag generation. This is a live-polling API — every
// response should be delivered fresh (200), never a cached 304 revalidation,
// which axios treats as an error and the dashboard reads as "offline".
app.disable('etag');
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ── PostgreSQL Connection Pool ───────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'farmdash',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

pool.connect()
<<<<<<< HEAD
  .then((client) => {
    client.release();
    console.log('✅ PostgreSQL connected');
  })
  .catch((err) => console.error('❌ PostgreSQL connection error:', err));
=======
  .then(async client => {
    try {
      const existingSchema = await client.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'users'`
      );
      if (existingSchema.rowCount === 0) {
        await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
      }
      console.log('✅ PostgreSQL connected and schema ready');
    } finally {
      client.release();
    }
  })
  .catch(err => console.error('❌ PostgreSQL connection error:', err));
>>>>>>> 77b06f8b77062746943518069c3ce17d1a8e9f67

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Base64 photos are far bigger than Express's 100 KB default limit.
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const result = await pool.query(
      `SELECT COUNT(*)::int AS table_count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users', 'nodes', 'sensor_readings', 'irrigation_log', 'aflc_decisions')`
    );
    const schemaReady = result.rows[0].table_count === 5;
    if (!schemaReady) {
      return res.status(503).json({
        status: 'error',
        database: 'connected',
        schema: 'missing',
        message: 'Run backend/schema.sql against the farmdash database',
      });
    }
    res.json({ status: 'ok', database: 'connected', schema: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'error', database: 'unavailable', schema: 'unknown', message: err.message });
  }
});

// ── JWT Auth Middleware ───────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log('🟢 WebSocket client connected');

  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

function broadcast(data) {
  const message = JSON.stringify(data);

  wsClients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  });
}

// ── One-shot device command flags ─────────────────────────────────────────────
// Motor command flag — set by frontend, consumed by ESP32 on next reservoir POST
let motorCommandPending = false;

// Camera command flag — set by frontend, consumed by ESP32 on next command poll
let cameraCommandPending = false;

// Irrigation command flag — set by /api/irrigate-all, consumed by ESP32
let irrigationCommandPending = false;

// ── External services ─────────────────────────────────────────────────────────
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const AFLC_SERVICE_URL = process.env.AFLC_SERVICE_URL || 'http://127.0.0.1:5001';

/**
 * Sends a base64 image to the MobileNetV3 service.
 * Returns { label, confidence, probabilities, timestamp } or null on failure.
 */
async function predictPlantHealth(imageBase64) {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageBase64 }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      throw new Error(`ML service returned ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error('[ML] Prediction failed:', err.message);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
<<<<<<< HEAD
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
=======
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE LOWER(TRIM(email)) = $1', [email]);
    const user   = result.rows[0];
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const isBcryptHash = /^\$2[aby]?\$\d{2}\$/.test(user.password);
    const valid = isBcryptHash
      ? await bcrypt.compare(password, user.password)
      : password === user.password;
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
>>>>>>> 77b06f8b77062746943518069c3ce17d1a8e9f67

    // Upgrade accounts created before password hashing was enabled.
    if (!isBcryptHash) {
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query('UPDATE users SET password = $1 WHERE id = $2', [passwordHash, user.id]);
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (_req, res) => {
  res.json({ success: true });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// SENSOR DATA — called by ESP32 every 30s, no auth token needed
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/sensor-data
app.post('/api/sensor-data', async (req, res) => {
  const {
    node_id,
    temperature,
    humidity,
    soil_moisture,
    soil_ph,
    lux,
  } = req.body;

  if (!node_id) {
    return res.status(400).json({ message: 'node_id is required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. UPSERT the live node row
    await client.query(
      `INSERT INTO nodes (
         node_id, name, layer_number, temperature, humidity,
         soil_moisture, soil_ph, lux
       )
       VALUES ($1, $1, 1, $2, $3, $4, $5, $6)
       ON CONFLICT (node_id) DO UPDATE SET
         temperature   = COALESCE(EXCLUDED.temperature, nodes.temperature),
         humidity      = COALESCE(EXCLUDED.humidity, nodes.humidity),
         soil_moisture = COALESCE(EXCLUDED.soil_moisture, nodes.soil_moisture),
         soil_ph       = COALESCE(EXCLUDED.soil_ph, nodes.soil_ph),
         lux           = COALESCE(EXCLUDED.lux, nodes.lux),
         updated_at    = NOW()`,
      [
        node_id,
        temperature ?? null,
        humidity ?? null,
        soil_moisture ?? null,
        soil_ph ?? null,
        lux ?? null,
      ]
    );

    // 2. Append to history
    const reading = await client.query(
      `INSERT INTO sensor_readings (
         node_id, temperature, humidity, soil_moisture, soil_ph, lux
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        node_id,
        temperature ?? null,
        humidity ?? null,
        soil_moisture ?? null,
        soil_ph ?? null,
        lux ?? null,
      ]
    );

    await client.query('COMMIT');

    // 3. Tell connected React tabs to refresh immediately
    broadcast({ type: 'sensor_update', data: reading.rows[0] });

    // Consume pending irrigation command (one-shot)
    const triggerPump = irrigationCommandPending;
    if (triggerPump) {
      irrigationCommandPending = false;
      console.log(`[PUMP] Irrigation command dispatched to ESP32 (${node_id})`);
    }

    console.log(
      `[ESP32] ${node_id} → temp=${temperature} humi=${humidity} ` +
      `soil=${soil_moisture} ph=${soil_ph} lux=${lux}`
    );

    return res.json({
      status: 'ok',
      data: reading.rows[0],
      irrigate_pump: triggerPump,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Sensor insert error:', err);

    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// NODE ROUTES — consumed by App.jsx
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/nodes
 * App.jsx maps rows by row.name → nodeData.node1 / nodeData.node2.
 * We alias node_id AS name so the frontend key lookup works.
 */
app.get('/api/nodes', requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        node_id AS name,
        node_id,
        COALESCE(temperature, 24.5) AS temperature,
        COALESCE(humidity, 65.0) AS humidity,
        COALESCE(soil_moisture, 72.0) AS soil_moisture,
        COALESCE(soil_ph, 6.8) AS soil_ph,
        COALESCE(lux, 0.0) AS lux,
        COALESCE(irrigation_status, 'idle') AS irrigation_status,
        CASE
          WHEN last_irrigation IS NULL THEN 'Never'
          ELSE TO_CHAR(last_irrigation, 'HH12:MI AM')
        END AS last_irrigation
      FROM nodes
      WHERE is_active = true
      ORDER BY node_id
    `);

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

/**
 * PUT /api/nodes/:id/sensors
 * Called by App.jsx when user manually edits a sensor via the slider modal.
 * Body: { temperature?, humidity?, soilMoisture?, soilPH?, lux? }
 */
app.put('/api/nodes/:id/sensors', requireAuth, async (req, res) => {
  const { id } = req.params;
  const {
    temperature,
    humidity,
    soilMoisture,
    soilPH,
    lux,
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE nodes SET
         temperature   = COALESCE($1, temperature),
         humidity      = COALESCE($2, humidity),
         soil_moisture = COALESCE($3, soil_moisture),
         soil_ph       = COALESCE($4, soil_ph),
         lux           = COALESCE($5, lux),
         updated_at    = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        temperature ?? null,
        humidity ?? null,
        soilMoisture ?? null,
        soilPH ?? null,
        lux ?? null,
        id,
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Node not found' });
    }

    // Also log to history
    const row = result.rows[0];
    await pool.query(
      `INSERT INTO sensor_readings (
         node_id, temperature, humidity, soil_moisture, soil_ph, lux
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        row.node_id,
        row.temperature,
        row.humidity,
        row.soil_moisture,
        row.soil_ph,
        row.lux,
      ]
    );

    broadcast({ type: 'sensor_update', nodeId: id });
    return res.json(row);
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

/**
 * POST /api/nodes/:id/irrigate
 * Called by App.jsx "Manual Irrigate" button.
 * Body: { triggeredBy: 'manual' }
 */
app.post('/api/nodes/:id/irrigate', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { triggeredBy = 'manual' } = req.body;

  try {
    const update = await pool.query(
      `UPDATE nodes
       SET irrigation_status = 'active', updated_at = NOW()
       WHERE id = $1
       RETURNING id, node_id`,
      [id]
    );

    if (!update.rows[0]) {
      return res.status(404).json({ message: 'Node not found' });
    }

    broadcast({
      type: 'irrigation_start',
      nodeId: id,
      triggeredBy,
    });

    await pool.query(
      `INSERT INTO irrigation_log (node_id, triggered_by)
       VALUES ($1, $2)`,
      [update.rows[0].node_id, triggeredBy]
    );

    // Auto-complete after 5 seconds
    setTimeout(async () => {
      try {
        await pool.query(
          `UPDATE nodes SET
             irrigation_status = 'idle',
             last_irrigation   = NOW(),
             updated_at        = NOW()
           WHERE id = $1`,
          [id]
        );

        broadcast({ type: 'irrigation_complete', nodeId: id });
      } catch (err) {
        console.error('[IRRIGATE] Auto-complete failed:', err.message);
      }
    }, 5000);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

/**
 * POST /api/irrigate-all
 * Called by the single system-wide "Irrigate Entire System" button in App.jsx.
 * 1. Marks every active node as irrigating in the DB.
 * 2. Sets irrigationCommandPending so the next ESP32 request receives
 *    irrigate_pump: true.
 * 3. Auto-completes all nodes after 10 s (matches the frontend timer).
 */
app.post('/api/irrigate-all', requireAuth, async (req, res) => {
  const { triggeredBy = 'manual' } = req.body;

  try {
    const nodes = await pool.query(
      `SELECT id, node_id
       FROM nodes
       WHERE is_active = true`
    );

    for (const node of nodes.rows) {
      await pool.query(
        `UPDATE nodes
         SET irrigation_status = 'active', updated_at = NOW()
         WHERE id = $1`,
        [node.id]
      );

      await pool.query(
        `INSERT INTO irrigation_log (node_id, triggered_by)
         VALUES ($1, $2)`,
        [node.node_id, triggeredBy]
      );
    }

    // Signal the ESP32 to fire the pump on its next request.
    irrigationCommandPending = true;

    broadcast({
      type: 'irrigation_start',
      triggeredBy,
      scope: 'all',
    });

    console.log(
      `[IRRIGATE-ALL] Command issued — ${nodes.rows.length} node(s) marked active, ` +
      'pump flag set'
    );

    // Auto-complete after 10 s
    setTimeout(async () => {
      try {
        await pool.query(
          `UPDATE nodes SET
             irrigation_status = 'idle',
             last_irrigation = NOW(),
             updated_at = NOW()
           WHERE is_active = true`
        );

        broadcast({
          type: 'irrigation_complete',
          scope: 'all',
        });

        console.log('[IRRIGATE-ALL] Cycle complete — all nodes reset to idle');
      } catch (err) {
        console.error('[IRRIGATE-ALL] Auto-complete failed:', err.message);
      }
    }, 10000);

    return res.json({
      ok: true,
      nodesTriggered: nodes.rows.length,
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

/**
 * GET /api/irrigation/command
 * Polled by ESP32 every 2–3 s. Returns the pending flag and clears it
 * (one-shot). No auth — device endpoint.
 */
app.get('/api/irrigation/command', (req, res) => {
  const pending = irrigationCommandPending;

  if (pending) {
    irrigationCommandPending = false;
    console.log('[PUMP] Irrigation command polled by ESP32 — flag cleared');
  }

  return res.json({ irrigate_pump: pending });
});

// ═════════════════════════════════════════════════════════════════════════════
// AFLC ROUTE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/aflc/:id
 * Forwards sensor values to the AFLC FastAPI/Flask service and stores the result.
 * Body: { temperature, humidity, co2, light, ... }
 */
app.post('/api/aflc/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const response = await fetch(`${AFLC_SERVICE_URL}/aflc/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `AFLC service returned ${response.status}${body ? `: ${body}` : ''}`
      );
    }

    const decision = await response.json();

    await pool.query(
      `INSERT INTO aflc_decisions (
         node_id, decision, confidence, reason,
         ecl, chs, stress_score, demand_pct, demand_bracket,
         hold_delay_sec, pump_duration_sec, base_duration_sec,
         adaptive_gain_sec, condition_persisted_sec, deviations
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        decision.decision,
        decision.confidence,
        decision.reason,
        decision.ecl ?? null,
        decision.chs ?? null,
        decision.stressScore ?? null,
        decision.demandPct ?? null,
        decision.demandBracket ?? null,
        decision.holdDelaySec ?? null,
        decision.pumpDurationSec ?? null,
        decision.baseDurationSec ?? null,
        decision.adaptiveGainSec ?? null,
        decision.conditionPersistedSec ?? null,
        decision.deviations ? JSON.stringify(decision.deviations) : null,
      ]
    );

    return res.json(decision);
  } catch (err) {
    console.error('[AFLC] Service error:', err.message);
    return res.status(502).json({
      message: `AFLC service unreachable: ${err.message}`,
    });
  }
});

/**
 * GET /api/aflc/:id/latest
 * Returns the most recent persisted AFLC decision for a node — the real
 * output from the Python controller (ecl, chs, demandPct, holdDelaySec,
 * etc.), not the frontend's local calculateAFLCDecision() heuristic.
 * Used by the dashboard to show actual AFLC reasoning instead of a guess.
 */
app.get('/api/aflc/:id/latest', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT decision, confidence, reason,
              ecl, chs, stress_score, demand_pct, demand_bracket,
              hold_delay_sec, pump_duration_sec, base_duration_sec,
              adaptive_gain_sec, condition_persisted_sec, deviations,
              created_at
       FROM aflc_decisions
       WHERE node_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'No AFLC decision recorded yet for this node' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// RESERVOIR ROUTES — driven by the ESP32 water-quality board
//
// ESP32 payload (sent every second via POST /api/reservoir):
//   { ph, ph_raw, ph_voltage, tds_ppm, tds_raw,
//     turbidity_ntu, turbidity_raw, water_present,
//     motor_running, motor_state, ts }
//
// DB field mapping:
//   ph              → water_ph
//   tds_ppm         → tds
//   turbidity_ntu   → turbidity
//   water_present   → water_level_triggered
//                       (INVERTED: present=true means OK,
//                        triggered=true means LOW water)
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/reservoir — called by ESP32 every second, no auth needed
app.post('/api/reservoir', async (req, res) => {
  const {
    ph,
    ph_raw,
    ph_voltage,
    tds_ppm,
    tds_raw,
    turbidity_ntu,
    turbidity_raw,
    water_present,
    motor_running,
    motor_state,
    ts,
  } = req.body;

  if (ph === undefined && tds_ppm === undefined) {
    return res.status(400).json({ message: 'No sensor fields received' });
  }

  const waterLevelTriggered = water_present === undefined
    ? false
    : !water_present;

  try {
    // 1. Upsert live reservoir state (single row, id=1)
    await pool.query(
      `INSERT INTO reservoir (
         id, water_ph, tds, turbidity, water_level_triggered,
         motor_running, motor_state, updated_at
       )
       VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         water_ph              = EXCLUDED.water_ph,
         tds                   = EXCLUDED.tds,
         turbidity             = EXCLUDED.turbidity,
         water_level_triggered = EXCLUDED.water_level_triggered,
         motor_running         = EXCLUDED.motor_running,
         motor_state           = EXCLUDED.motor_state,
         updated_at            = NOW()`,
      [
        ph ?? null,
        tds_ppm ?? null,
        turbidity_ntu ?? null,
        waterLevelTriggered,
        motor_running ?? null,
        motor_state ?? null,
      ]
    );

    // 2. Append full raw reading to history log
    await pool.query(
      `INSERT INTO reservoir_log (
         water_ph, ph_raw, ph_voltage,
         tds, tds_raw,
         turbidity, turbidity_raw,
         water_present, water_level_triggered,
         motor_running, motor_state
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        ph ?? null,
        ph_raw ?? null,
        ph_voltage ?? null,
        tds_ppm ?? null,
        tds_raw ?? null,
        turbidity_ntu ?? null,
        turbidity_raw ?? null,
        water_present ?? null,
        waterLevelTriggered,
        motor_running ?? null,
        motor_state ?? null,
      ]
    );

    // 3. Push live update to all connected React tabs
    broadcast({ type: 'reservoir_update' });

    // 4. Extra broadcast if water is currently low
    if (waterLevelTriggered) {
      broadcast({ type: 'water_level_alert' });
    }

    console.log(
      `[ESP32-RESERVOIR] pH=${ph} (${ph_voltage}V) | ` +
      `TDS=${tds_ppm}ppm | Turbidity=${turbidity_ntu}NTU | ` +
      `Water=${water_present ? 'OK' : 'LOW!'} | Motor=${motor_state} | ts=${ts ?? 'n/a'}`
    );

    // Consume the pending motor command (one-shot)
    const triggerMotor = motorCommandPending;
    if (triggerMotor) {
      motorCommandPending = false;
      console.log('[MOTOR] Command dispatched to ESP32');
    }

    return res.json({
      status: 'ok',
      motor_command: triggerMotor,
    });
  } catch (err) {
    console.error('[ESP32-RESERVOIR] Insert error:', err.message);

    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

// POST /api/reservoir/motor/run — triggered by frontend button, requires auth
// Sets a one-shot flag that the ESP32 will receive on its next POST.
app.post('/api/reservoir/motor/run', requireAuth, (_req, res) => {
  motorCommandPending = true;
  console.log('[MOTOR] Command queued — ESP32 will pick it up on next POST');

  return res.json({
    ok: true,
    message: 'Motor command queued for ESP32',
  });
});

// GET /api/reservoir — polled by App.jsx every 8 s, requires auth
app.get('/api/reservoir', requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM reservoir WHERE id = 1'
    );

    if (!result.rows[0]) {
      // No data yet — return safe defaults so the dashboard doesn't crash.
      return res.json({
        water_ph: 6.2,
        tds: 850,
        turbidity: 12,
        water_level_triggered: false,
        motor_running: false,
        motor_state: 'STOPPED',
        updated_at: null,
      });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

// GET /api/reservoir/log — last N raw readings
app.get('/api/reservoir/log', requireAuth, async (req, res) => {
  const requestedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 500)
    : 50;

  try {
    const result = await pool.query(
      `SELECT *
       FROM reservoir_log
       ORDER BY recorded_at DESC
       LIMIT $1`,
      [limit]
    );

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CAMERA ROUTES — ESP32-CAM (separate from reservoir)
//
// ESP32-CAM uploads to:   POST /api/camera/upload   (no auth — device endpoint)
// Frontend triggers via:  POST /api/camera/capture  (auth required)
// Manual test upload:     POST /api/camera/analyze  (auth required)
//
// Flow:
//   1. User presses Capture button → POST /api/camera/capture → sets flag
//   2. ESP32 sends its next image → POST /api/camera/upload
//      → server replies right away (includes camera_command flag)
//      → server runs the ML service on the image
//      → broadcasts camera_image (with mlResult) over WebSocket
//   3. ESP32 may react to camera_command:true by capturing again
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/camera/command — polled by ESP32 every few seconds
app.get('/api/camera/command', (_req, res) => {
  const pending = cameraCommandPending;

  if (pending) {
    cameraCommandPending = false;
    console.log('[CAMERA] Command polled by ESP32 — triggering capture');
  }

  return res.json({ camera_command: pending });
});

// POST /api/camera/capture — frontend "Capture" button; requires auth
app.post('/api/camera/capture', requireAuth, (_req, res) => {
  cameraCommandPending = true;
  console.log('[CAMERA] Capture command queued — ESP32 will pick it up on next poll');

  return res.json({
    ok: true,
    message: 'Camera capture command queued for ESP32',
  });
});

// POST /api/camera/analyze — manual image upload from the dashboard
app.post('/api/camera/analyze', requireAuth, async (req, res) => {
  const { image_base64: imageBase64 } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ message: 'image_base64 is required' });
  }

  const mlResult = await predictPlantHealth(imageBase64);

  if (!mlResult) {
    return res.status(502).json({
      message: `ML service unreachable at ${ML_SERVICE_URL}. Is it running?`,
    });
  }

  console.log(
    `[ML] Manual upload → ${mlResult.label} (${mlResult.confidence}%)`
  );

  return res.json({ mlResult });
});

// POST /api/camera/upload — called by ESP32-CAM; no auth token needed
app.post('/api/camera/upload', async (req, res) => {
  const {
    image_base64: imageBase64,
    width,
    height,
    file_size: fileSize,
  } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ message: 'image_base64 is required' });
  }

  const capturedAt = new Date().toISOString();

  // Consume the pending capture command (one-shot)
  const triggerCapture = cameraCommandPending;
  if (triggerCapture) {
    cameraCommandPending = false;
    console.log('[CAMERA] Capture command dispatched to ESP32');
  }

  // Answer the ESP32 immediately — inference happens after the reply.
  res.json({
    status: 'ok',
    capturedAt,
    camera_command: triggerCapture,
  });

  try {
    const mlResult = await predictPlantHealth(imageBase64);

    // Broadcast image (+ ML result) to all connected React tabs.
    broadcast({
      type: 'camera_image',
      imageData: `data:image/jpeg;base64,${imageBase64}`,
      width: width ?? 320,
      height: height ?? 240,
      fileSize: fileSize ?? 0,
      capturedAt,
      mlResult,
    });

    console.log(
      `[ESP32-CAM] Image received — ${width ?? 320}×${height ?? 240}px, ` +
      `${fileSize ?? 0} bytes @ ${capturedAt} | ` +
      `ML=${mlResult ? `${mlResult.label} (${mlResult.confidence}%)` : 'n/a'}`
    );
  } catch (err) {
    // The ESP32 has already received its success response, so only log the
    // asynchronous post-processing failure here.
    console.error('[ESP32-CAM] Post-upload processing error:', err.message);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// NODE HISTORY / IRRIGATION LOG ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/nodes/:id/history', requireAuth, async (req, res) => {
  const requestedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 500)
    : 20;

  try {
    const result = await pool.query(
      `SELECT *
       FROM sensor_readings
       WHERE node_id = (
         SELECT node_id FROM nodes WHERE id = $1
       )
       ORDER BY recorded_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

app.get('/api/nodes/:id/irrigation-log', requireAuth, async (req, res) => {
  const requestedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 500)
    : 10;

  try {
    const result = await pool.query(
      `SELECT *
       FROM irrigation_log
       WHERE node_id = (
         SELECT node_id FROM nodes WHERE id = $1
       )
       ORDER BY triggered_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});
