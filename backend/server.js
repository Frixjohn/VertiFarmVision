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
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  buildWorkbook,
  getExportOptions,
  parseExportParams,
} = require('./exportXlsx');

require('dotenv').config({
  path: path.join(__dirname, '.env'),
  override: true,
});

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
  .then(async (client) => {
    try {
      const existingSchema = await client.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'users'`
      );

      if (existingSchema.rowCount === 0) {
        await client.query(
          fs.readFileSync(
            path.join(__dirname, 'schema.sql'),
            'utf8'
          )
        );
      }

      console.log('✅ PostgreSQL connected and schema ready');
    } finally {
      client.release();
    }
  })
  .catch((err) => {
    console.error('❌ PostgreSQL connection error:', err);
  });

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Base64 photos are far bigger than Express's 100 KB default limit.
app.use(express.json({ limit: '10mb' }));

// ── Health Check ─────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    const result = await pool.query(
      `SELECT COUNT(*)::int AS table_count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'users',
           'nodes',
           'sensor_readings',
           'irrigation_log',
           'aflc_decisions'
         )`
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

    res.json({
      status: 'ok',
      database: 'connected',
      schema: 'ready',
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      database: 'unavailable',
      schema: 'unknown',
      message: err.message,
    });
  }
});

// ── JWT Auth Middleware ───────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      message: 'No token provided',
    });
  }

  try {
    req.user = jwt.verify(
      token,
      process.env.JWT_SECRET || 'dev-secret'
    );

    next();
  } catch {
    return res.status(401).json({
      message: 'Invalid or expired token',
    });
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);

  console.log('🟢 WebSocket client connected');

  ws.on('close', () => {
    wsClients.delete(ws);
  });

  ws.on('error', () => {
    wsClients.delete(ws);
  });
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

// ── External Services ─────────────────────────────────────────────────────────

const ML_SERVICE_URL =
  process.env.ML_SERVICE_URL || 'http://localhost:8000';

const AFLC_SERVICE_URL =
  process.env.AFLC_SERVICE_URL || 'http://127.0.0.1:5001';

/**
 * Sends a base64 image to the MobileNetV3 service.
 * Returns { label, confidence, probabilities, timestamp } or null on failure.
 */
async function predictPlantHealth(imageBase64) {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_base64: imageBase64,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      throw new Error(
        `ML service returned ${response.status}`
      );
    }

    return await response.json();
  } catch (err) {
    console.error(
      '[ML] Prediction failed:',
      err.message
    );

    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/auth/login

app.post('/api/auth/login', async (req, res) => {
  const email = String(
    req.body.email || ''
  ).trim().toLowerCase();

  const password = String(
    req.body.password || ''
  );

  if (!email || !password) {
    return res.status(400).json({
      message: 'Email and password are required',
    });
  }

  try {
    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE LOWER(TRIM(email)) = $1`,
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        message: 'Invalid credentials',
      });
    }

    const isBcryptHash =
      /^\$2[aby]?\$\d{2}\$/.test(user.password);

    const valid = isBcryptHash
      ? await bcrypt.compare(password, user.password)
      : password === user.password;

    if (!valid) {
      return res.status(401).json({
        message: 'Invalid credentials',
      });
    }

    // Upgrade accounts created before password hashing was enabled.
    if (!isBcryptHash) {
      const passwordHash = await bcrypt.hash(
        password,
        12
      );

      await pool.query(
        'UPDATE users SET password = $1 WHERE id = $2',
        [passwordHash, user.id]
      );
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
      },
      process.env.JWT_SECRET || 'dev-secret',
      {
        expiresIn: '7d',
      }
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
  res.json({
    success: true,
  });
});

// GET /api/auth/me

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        message: 'User not found',
      });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({
      message: 'Server error',
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// SENSOR DATA
// Called by ESP32 every 30s, no auth token needed
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
    co2,
  } = req.body;

  if (!node_id) {
    return res.status(400).json({
      message: 'node_id is required',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. UPSERT the live node row
    await client.query(
      `INSERT INTO nodes (
         node_id,
         name,
         layer_number,
         temperature,
         humidity,
         soil_moisture,
         soil_ph,
         lux,
         co2
       )
       VALUES (
         $1,
         $1,
         1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7
       )
       ON CONFLICT (node_id) DO UPDATE SET
         temperature =
           COALESCE(EXCLUDED.temperature, nodes.temperature),
         humidity =
           COALESCE(EXCLUDED.humidity, nodes.humidity),
         soil_moisture =
           COALESCE(EXCLUDED.soil_moisture, nodes.soil_moisture),
         soil_ph =
           COALESCE(EXCLUDED.soil_ph, nodes.soil_ph),
         lux =
           COALESCE(EXCLUDED.lux, nodes.lux),
         co2 =
           COALESCE(EXCLUDED.co2, nodes.co2),
         updated_at = NOW()`,
      [
        node_id,
        temperature ?? null,
        humidity ?? null,
        soil_moisture ?? null,
        soil_ph ?? null,
        lux ?? null,
        co2 ?? null,
      ]
    );

    // 2. Append to history
    const reading = await client.query(
      `INSERT INTO sensor_readings (
         node_id,
         temperature,
         humidity,
         soil_moisture,
         soil_ph,
         lux,
         co2
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        node_id,
        temperature ?? null,
        humidity ?? null,
        soil_moisture ?? null,
        soil_ph ?? null,
        lux ?? null,
        co2 ?? null,
      ]
    );

    await client.query('COMMIT');

    // 3. Tell connected React tabs to refresh immediately
    broadcast({
      type: 'sensor_update',
      data: reading.rows[0],
    });

    // NOTE: the pump flag is consumed ONLY by the actuator board via
    // GET /api/irrigation/command. The environment node has no pump, so it
    // must not swallow the command here.
    const triggerPump = false;

    console.log(
      `[ESP32] ${node_id} → temp=${temperature} ` +
      `humi=${humidity} soil=${soil_moisture} ` +
      `ph=${soil_ph} lux=${lux}`
    );

    return res.json({
      status: 'ok',
      data: reading.rows[0],
      irrigate_pump: triggerPump,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    console.error(
      'Sensor insert error:',
      err
    );

    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// NODE ROUTES
// Consumed by App.jsx
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/nodes
 *
 * App.jsx maps rows by row.name → nodeData[<key>] for each key in NODES.
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
        COALESCE(co2, 800.0) AS co2,
        COALESCE(irrigation_status, 'idle') AS irrigation_status,
        CASE
          WHEN last_irrigation IS NULL
            THEN 'Never'
          ELSE TO_CHAR(
            last_irrigation,
            'HH12:MI AM'
          )
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
 *
 * Called by App.jsx when user manually edits a sensor
 * via the slider modal.
 *
 * Body:
 * {
 *   temperature?,
 *   humidity?,
 *   soilMoisture?,
 *   soilPH?,
 *   lux?
 * }
 */

app.put(
  '/api/nodes/:id/sensors',
  requireAuth,
  async (req, res) => {
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
           temperature =
             COALESCE($1, temperature),
           humidity =
             COALESCE($2, humidity),
           soil_moisture =
             COALESCE($3, soil_moisture),
           soil_ph =
             COALESCE($4, soil_ph),
           lux =
             COALESCE($5, lux),
           updated_at = NOW()
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
        return res.status(404).json({
          message: 'Node not found',
        });
      }

      // Also log to history
      const row = result.rows[0];

      await pool.query(
        `INSERT INTO sensor_readings (
           node_id,
           temperature,
           humidity,
           soil_moisture,
           soil_ph,
           lux
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

      broadcast({
        type: 'sensor_update',
        nodeId: id,
      });

      return res.json(row);
    } catch (err) {
      return res.status(500).json({
        message: 'Server error',
        error: err.message,
      });
    }
  }
);

/**
 * POST /api/nodes/:id/irrigate
 *
 * Called by App.jsx "Manual Irrigate" button.
 * Body: { triggeredBy: 'manual' }
 */

app.post(
  '/api/nodes/:id/irrigate',
  requireAuth,
  async (req, res) => {
    const { id } = req.params;
    const { triggeredBy = 'manual' } = req.body;

    try {
      const update = await pool.query(
        `UPDATE nodes
         SET irrigation_status = 'active',
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, node_id`,
        [id]
      );

      if (!update.rows[0]) {
        return res.status(404).json({
          message: 'Node not found',
        });
      }

      broadcast({
        type: 'irrigation_start',
        nodeId: id,
        triggeredBy,
      });

      await pool.query(
        `INSERT INTO irrigation_log (
           node_id,
           triggered_by
         )
         VALUES ($1, $2)`,
        [
          update.rows[0].id,
          triggeredBy,
        ]
      );

      // Auto-complete after 5 seconds
      setTimeout(async () => {
        try {
          await pool.query(
            `UPDATE nodes SET
               irrigation_status = 'idle',
               last_irrigation = NOW(),
               updated_at = NOW()
             WHERE id = $1`,
            [id]
          );

          broadcast({
            type: 'irrigation_complete',
            nodeId: id,
          });
        } catch (err) {
          console.error(
            '[IRRIGATE] Auto-complete failed:',
            err.message
          );
        }
      }, 5000);

      return res.json({
        ok: true,
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Server error',
        error: err.message,
      });
    }
  }
);

/**
 * POST /api/irrigate-all
 *
 * Called by the single system-wide
 * "Irrigate Entire System" button in App.jsx.
 *
 * 1. Marks every active node as irrigating in the DB.
 * 2. Sets irrigationCommandPending so the next ESP32
 *    request receives irrigate_pump: true.
 * 3. Auto-completes all nodes after 10 s.
 */

app.post(
  '/api/irrigate-all',
  requireAuth,
  async (req, res) => {
    const { triggeredBy = 'manual' } = req.body || {};

    // 1. Queue the pump command FIRST. The physical pump must never
    //    depend on database bookkeeping succeeding.
    irrigationCommandPending = true;

    console.log(
      '[IRRIGATE-ALL] Pump flag set — actuator ESP32 will pick it up on its next poll'
    );

    let nodesTriggered = 0;
    let dbWarning = null;

    // 2. Bookkeeping (node status + irrigation log). Non-fatal.
    try {
      const nodes = await pool.query(
        `SELECT id, node_id
         FROM nodes
         WHERE is_active = true`
      );

      nodesTriggered = nodes.rows.length;

      for (const node of nodes.rows) {
        await pool.query(
          `UPDATE nodes
           SET irrigation_status = 'active',
               updated_at = NOW()
           WHERE id = $1`,
          [node.id]
        );

        try {
          await pool.query(
            `INSERT INTO irrigation_log (
               node_id,
               triggered_by
             )
             VALUES ($1, $2)`,
            [
              node.id,
              triggeredBy,
            ]
          );
        } catch (logErr) {
          dbWarning = `irrigation_log insert failed: ${logErr.message}`;

          console.error(
            '[IRRIGATE-ALL] irrigation_log insert failed:',
            logErr.message
          );
        }
      }

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

          console.log(
            '[IRRIGATE-ALL] Cycle complete — ' +
            'all nodes reset to idle'
          );
        } catch (err) {
          console.error(
            '[IRRIGATE-ALL] Auto-complete failed:',
            err.message
          );
        }
      }, 10000);
    } catch (err) {
      dbWarning = err.message;

      console.error(
        '[IRRIGATE-ALL] Database bookkeeping failed (pump command was still queued):',
        err.message
      );
    }

    broadcast({
      type: 'irrigation_start',
      triggeredBy,
      scope: 'all',
    });

    console.log(
      `[IRRIGATE-ALL] Command issued — ${nodesTriggered} node(s) marked active` +
      (dbWarning ? ` (DB warning: ${dbWarning})` : '')
    );

    return res.json({
      ok: true,
      nodesTriggered,
      ...(dbWarning ? { warning: dbWarning } : {}),
    });
  }
);

/**
 * GET /api/irrigation/command
 *
 * Polled by ESP32 every 2–3 s.
 * Returns the pending flag and clears it.
 * No auth — device endpoint.
 */

app.get('/api/irrigation/command', (req, res) => {
  const pending = irrigationCommandPending;

  if (pending) {
    irrigationCommandPending = false;

    console.log(
      '[PUMP] Irrigation command polled by ESP32 — flag cleared'
    );
  }

  return res.json({
    irrigate_pump: pending,
  });
});

// ── AFLC scheduler ───────────────────────────────────────────────────────────
// The server (not the browser) asks the AFLC service for a decision on a fixed
// schedule, using the node's REAL latest values from the database.
//
//   AFLC_INTERVAL_MS      default 600000 (10 minutes)
//   AFLC_NODE_IDS         default NODE-01   (comma-separated node_id list)
//   AFLC_MAX_READING_AGE_MIN  default 15    (skip a node that stopped reporting)

const AFLC_INTERVAL_MS =
  Number(process.env.AFLC_INTERVAL_MS) || 10 * 60 * 1000;

const AFLC_NODE_IDS = (process.env.AFLC_NODE_IDS || 'NODE-01')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const AFLC_MAX_READING_AGE_MIN =
  Number(process.env.AFLC_MAX_READING_AGE_MIN) || 15;

// ── Heartbeat: what the scheduler is doing right now ─────────────────────────
// Read by GET /api/aflc/status so the dashboard can prove the AFLC is alive.
const aflcStatus = {
  intervalMs: AFLC_INTERVAL_MS,
  maxReadingAgeMin: AFLC_MAX_READING_AGE_MIN,
  bootAt: Date.now(),
  running: false,
  cycleCount: 0,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  nextRunAt: null,
  nodes: {}, // node_id -> { nodeId, outcome: decided|skipped|failed, detail, at }
};

function noteAflcNode(nodeId, outcome, detail) {
  aflcStatus.nodes[nodeId] = { nodeId, outcome, detail, at: Date.now() };
}

async function storeAflcDecision(nodeDbId, decision) {
  await pool.query(
    `INSERT INTO aflc_decisions (
       node_id,
       decision,
       confidence,
       reason,
       ecl,
       chs,
       stress_score,
       demand_pct,
       demand_bracket,
       hold_delay_sec,
       pump_duration_sec,
       base_duration_sec,
       adaptive_gain_sec,
       condition_persisted_sec,
       deviations
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15
     )`,
    [
      nodeDbId,
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
      decision.deviations
        ? JSON.stringify(decision.deviations)
        : null,
    ]
  );
}

let aflcRunning = false;

async function runAflcCycle() {
  if (aflcRunning) return; // never overlap two cycles
  aflcRunning = true;
  aflcStatus.running = true;
  aflcStatus.lastStartedAt = Date.now();
  aflcStatus.lastError = null;

  try {
    const { rows } = await pool.query(
      `SELECT n.id,
              n.node_id,
              n.temperature,
              n.humidity,
              n.co2,
              n.lux,
              (SELECT MAX(r.recorded_at)
                 FROM sensor_readings r
                WHERE r.node_id = n.node_id) AS last_reading
       FROM nodes n
       WHERE n.is_active = true
         AND n.node_id = ANY($1)
       ORDER BY n.id`,
      [AFLC_NODE_IDS]
    );

    for (const n of rows) {
      const ageMin = n.last_reading
        ? (Date.now() - new Date(n.last_reading).getTime()) / 60000
        : Infinity;

      if (ageMin > AFLC_MAX_READING_AGE_MIN) {
        console.log(
          `[AFLC] ${n.node_id} skipped — no sensor reading in the last ` +
          `${AFLC_MAX_READING_AGE_MIN} min`
        );
        noteAflcNode(
          n.node_id,
          'skipped',
          `No sensor reading in the last ${AFLC_MAX_READING_AGE_MIN} min`
        );
        continue;
      }

      if ([n.temperature, n.humidity, n.co2, n.lux].some((v) => v === null)) {
        console.log(`[AFLC] ${n.node_id} skipped — incomplete sensor values`);
        noteAflcNode(n.node_id, 'skipped', 'Incomplete sensor values');
        continue;
      }

      try {
        const response = await fetch(
          `${AFLC_SERVICE_URL}/aflc/${n.id}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              temperature: Number(n.temperature),
              humidity: Number(n.humidity),
              co2: Number(n.co2),
              light: Number(n.lux),
            }),
            signal: AbortSignal.timeout(20000),
          }
        );

        if (!response.ok) {
          throw new Error(`AFLC service returned ${response.status}`);
        }

        const decision = await response.json();
        await storeAflcDecision(n.id, decision);

        console.log(
          `[AFLC] ${n.node_id} → ${decision.decision} ` +
          `(${decision.ecl}, pump ${decision.pumpDurationSec}s)`
        );
        noteAflcNode(
          n.node_id,
          'decided',
          `${decision.decision} · ${decision.ecl}`
        );
      } catch (err) {
        console.error(`[AFLC] ${n.node_id} cycle failed:`, err.message);
        noteAflcNode(n.node_id, 'failed', err.message);
      }
    }

    // configured node ids that matched no active node in the DB
    const found = new Set(rows.map((r) => r.node_id));
    for (const id of AFLC_NODE_IDS) {
      if (!found.has(id)) {
        noteAflcNode(id, 'skipped', 'Node not found or not active');
      }
    }
  } catch (err) {
    console.error('[AFLC] Scheduler error:', err.message);
    aflcStatus.lastError = err.message;
  } finally {
    aflcRunning = false;
    aflcStatus.running = false;
    aflcStatus.lastFinishedAt = Date.now();
    aflcStatus.cycleCount += 1;
  }
}

function startAflcScheduler() {
  console.log(
    `[AFLC] Scheduler on — every ${Math.round(AFLC_INTERVAL_MS / 60000)} min ` +
    `for ${AFLC_NODE_IDS.join(', ')}`
  );
  // first decision shortly after boot (lets the sensors report first), then
  // every AFLC_INTERVAL_MS. A timeout chain (not setInterval) so the exact
  // time of the next run is always known and can be shown on the dashboard.
  const scheduleNext = (delayMs) => {
    aflcStatus.nextRunAt = Date.now() + delayMs;
    setTimeout(async () => {
      await runAflcCycle(); // never throws (handles its own errors)
      scheduleNext(AFLC_INTERVAL_MS);
    }, delayMs);
  };
  scheduleNext(30 * 1000);
}

// ═════════════════════════════════════════════════════════════════════════════
// AFLC ROUTE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/aflc/status
 *
 * Heartbeat for the dashboard: is the scheduler alive, is it thinking right
 * now, when does it run next, what happened to each node last cycle, and the
 * most recent decisions.
 */
app.get('/api/aflc/status', requireAuth, async (_req, res) => {
  let recent = [];
  try {
    const { rows } = await pool.query(
      `SELECT d.decision,
              d.confidence,
              d.reason,
              d.ecl,
              d.chs,
              d.stress_score,
              d.demand_pct,
              d.hold_delay_sec,
              d.pump_duration_sec,
              d.condition_persisted_sec,
              d.created_at,
              n.node_id AS node_label
         FROM aflc_decisions d
         LEFT JOIN nodes n ON n.id = d.node_id
        ORDER BY d.created_at DESC
        LIMIT 12`
    );
    recent = rows;
  } catch (err) {
    console.error('[AFLC] status query failed:', err.message);
  }

  res.json({
    serverNow: Date.now(),
    ...aflcStatus,
    nodes: Object.values(aflcStatus.nodes),
    recent,
  });
});

/**
 * POST /api/aflc/run-now
 *
 * Runs one AFLC cycle immediately (same code path as the scheduler) so you
 * can watch it work without waiting for the next tick. Does not move the
 * scheduled next run.
 */
app.post('/api/aflc/run-now', requireAuth, async (_req, res) => {
  if (aflcRunning) {
    return res.status(409).json({ message: 'An AFLC cycle is already running' });
  }
  await runAflcCycle();
  res.json({ ok: true, lastFinishedAt: aflcStatus.lastFinishedAt });
});

/**
 * POST /api/aflc/:id
 *
 * Forwards sensor values to the AFLC FastAPI/Flask service
 * and stores the result.
 *
 * Body:
 * {
 *   temperature,
 *   humidity,
 *   co2,
 *   light,
 *   ...
 * }
 */

app.post(
  '/api/aflc/:id',
  requireAuth,
  async (req, res) => {
    const { id } = req.params;

    try {
      const response = await fetch(
        `${AFLC_SERVICE_URL}/aflc/${id}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(20000),
        }
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');

        throw new Error(
          `AFLC service returned ${response.status}` +
          `${body ? `: ${body}` : ''}`
        );
      }

      const decision = await response.json();

      await storeAflcDecision(id, decision);

      return res.json(decision);
    } catch (err) {
      console.error(
        '[AFLC] Service error:',
        err.message
      );

      return res.status(502).json({
        message:
          `AFLC service unreachable: ${err.message}`,
      });
    }
  }
);

/**
 * GET /api/aflc/:id/latest
 *
 * Returns the most recent persisted AFLC decision for a node.
 */

app.get(
  '/api/aflc/:id/latest',
  requireAuth,
  async (req, res) => {
    const { id } = req.params;

    try {
      const result = await pool.query(
        `SELECT
           decision,
           confidence,
           reason,
           ecl,
           chs,
           stress_score,
           demand_pct,
           demand_bracket,
           hold_delay_sec,
           pump_duration_sec,
           base_duration_sec,
           adaptive_gain_sec,
           condition_persisted_sec,
           deviations,
           created_at
         FROM aflc_decisions
         WHERE node_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [id]
      );

      if (!result.rows[0]) {
        return res.status(404).json({
          message:
            'No AFLC decision recorded yet for this node',
        });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      return res.status(500).json({
        message: 'Server error',
        error: err.message,
      });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// RESERVOIR ROUTES
// Driven by the ESP32 water-quality board
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ESP32 payload:
 *
 * {
 *   ph,
 *   ph_raw,
 *   ph_voltage,
 *   tds_ppm,
 *   tds_raw,
 *   clarity_pct,        // water clarity, 0-100 %  (100 = clear, higher is better)
 *   turbidity_raw,      // turbidity probe voltage (V)
 *   water_present,
 *   motor_running,
 *   motor_state,
 *   ts
 * }
 *
 * DB field mapping:
 *
 * ph              → water_ph
 * tds_ppm         → tds
 * clarity_pct     → clarity
 * water_present   → water_level_triggered
 *
 * INVERTED:
 * present=true means OK,
 * triggered=true means LOW water
 */

// POST /api/reservoir
// Called by ESP32 every second, no auth needed

app.post('/api/reservoir', async (req, res) => {
  const {
    ph,
    ph_raw,
    ph_voltage,
    tds_ppm,
    tds_raw,
    clarity_pct,
    turbidity_ntu, // LEGACY firmware only, see below
    turbidity_raw,
    water_present,
    motor_running,
    motor_state,
    ts,
  } = req.body;

  // Clarity is stored as a 0-100 % value (higher = clearer). Older node
  // firmware sent a 0-100 "turbidity index" (lower = better, 50 = limit) as
  // turbidity_ntu; convert it so an un-reflashed node keeps working:
  //   index 0 -> 100 %,  index 50 -> 85 %,  index 100 -> 70 %
  let clarity = null;
  if (clarity_pct !== undefined && clarity_pct !== null) {
    clarity = Number(clarity_pct);
  } else if (turbidity_ntu !== undefined && turbidity_ntu !== null) {
    clarity = 100 - Number(turbidity_ntu) * 0.3;
  }
  clarity = Number.isFinite(clarity)
    ? Math.round(Math.min(100, Math.max(0, clarity)) * 10) / 10
    : null;

  if (
    ph === undefined &&
    tds_ppm === undefined &&
    clarity === null &&
    water_present === undefined
  ) {
    return res.status(400).json({
      message: 'No sensor fields received',
    });
  }

  const waterLevelTriggered =
    water_present === undefined
      ? false
      : !water_present;

  try {
    // 1. Upsert live reservoir state
    await pool.query(
      `INSERT INTO reservoir (
         id,
         water_ph,
         tds,
         clarity,
         water_level_triggered,
         motor_running,
         motor_state,
         updated_at
       )
       VALUES (
         1,
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         water_ph =
           COALESCE(EXCLUDED.water_ph, reservoir.water_ph),
         tds =
           COALESCE(EXCLUDED.tds, reservoir.tds),
         clarity =
           COALESCE(EXCLUDED.clarity, reservoir.clarity),
         water_level_triggered =
           EXCLUDED.water_level_triggered,
         motor_running =
           COALESCE(EXCLUDED.motor_running, reservoir.motor_running),
         motor_state =
           COALESCE(EXCLUDED.motor_state, reservoir.motor_state),
         updated_at = NOW()`,
      [
        ph ?? null,
        tds_ppm ?? null,
        clarity,
        waterLevelTriggered,
        motor_running ?? null,
        motor_state ?? null,
      ]
    );

    // 2. Append full raw reading to history log
    await pool.query(
      `INSERT INTO reservoir_log (
         water_ph,
         ph_raw,
         ph_voltage,
         tds,
         tds_raw,
         clarity,
         turbidity_raw,
         water_present,
         water_level_triggered,
         motor_running,
         motor_state
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
       )`,
      [
        ph ?? null,
        ph_raw ?? null,
        ph_voltage ?? null,
        tds_ppm ?? null,
        tds_raw ?? null,
        clarity,
        turbidity_raw ?? null,
        water_present ?? null,
        waterLevelTriggered,
        motor_running ?? null,
        motor_state ?? null,
      ]
    );

    // 3. Push live update to all connected React tabs
    broadcast({
      type: 'reservoir_update',
    });

    // 4. Extra broadcast if water is currently low
    if (waterLevelTriggered) {
      broadcast({
        type: 'water_level_alert',
      });
    }

    console.log(
      `[ESP32-RESERVOIR] pH=${ph} (${ph_voltage}V) | ` +
      `TDS=${tds_ppm}ppm | ` +
      `Clarity=${clarity}% | ` +
      `Water=${water_present ? 'OK' : 'LOW!'} | ` +
      `Motor=${motor_state} | ` +
      `ts=${ts ?? 'n/a'}`
    );

    // The stepper lives on the actuator board, which polls
    // GET /api/motor/command. The reservoir sensor board must not
    // consume the motor flag, so it is always false here.
    return res.json({
      status: 'ok',
      motor_command: false,
    });
  } catch (err) {
    console.error(
      '[ESP32-RESERVOIR] Insert error:',
      err.message
    );

    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

// POST /api/reservoir/motor/run
// Triggered by frontend button, requires auth

app.post(
  '/api/reservoir/motor/run',
  requireAuth,
  (_req, res) => {
    motorCommandPending = true;

    console.log(
      '[MOTOR] Command queued — ' +
      'ESP32 will pick it up on next POST'
    );

    return res.json({
      ok: true,
      message:
        'Motor command queued for ESP32',
    });
  }
);

// Safety net: if the actuator reports RUNNING but never reports STOPPED
// (power dip, reset, Wi-Fi drop), clear the stuck state so the dashboard
// button isn't locked forever.
const MOTOR_STATE_TTL_MS = 20000; // motor runs 15 s, so 20 s is a safe ceiling
let motorWatchdog = null;

async function forceMotorStopped(reason) {
  try {
    await pool.query(
      `UPDATE reservoir
       SET motor_running = false,
           motor_state = 'STOPPED',
           updated_at = NOW()
       WHERE id = 1`
    );

    broadcast({
      type: 'reservoir_update',
    });

    console.log(`[MOTOR] State forced to STOPPED (${reason})`);
  } catch (err) {
    console.error('[MOTOR] Could not reset state:', err.message);
  }
}

// GET /api/motor/command
// Polled by the actuator ESP32 every ~2 s. Returns the pending
// "run motor" flag and clears it. No auth — device endpoint.

app.get('/api/motor/command', (_req, res) => {
  const pending = motorCommandPending;

  if (pending) {
    motorCommandPending = false;

    console.log(
      '[MOTOR] Command polled by actuator ESP32 — flag cleared'
    );
  }

  return res.json({
    motor_command: pending,
  });
});

// POST /api/motor/status
// Actuator ESP32 reports { motor_running, motor_state } when it changes.
// No auth — device endpoint.

app.post('/api/motor/status', async (req, res) => {
  const { motor_running, motor_state } = req.body;

  if (motor_running === undefined) {
    return res.status(400).json({
      message: 'motor_running is required',
    });
  }

  try {
    await pool.query(
      `INSERT INTO reservoir (
         id,
         motor_running,
         motor_state,
         water_level_triggered,
         updated_at
       )
       VALUES (1, $1, $2, false, NOW())
       ON CONFLICT (id) DO UPDATE SET
         motor_running = EXCLUDED.motor_running,
         motor_state = EXCLUDED.motor_state,
         updated_at = NOW()`,
      [
        Boolean(motor_running),
        motor_state ?? (motor_running ? 'RUNNING' : 'STOPPED'),
      ]
    );

    broadcast({
      type: 'reservoir_update',
    });

    if (motorWatchdog) {
      clearTimeout(motorWatchdog);
      motorWatchdog = null;
    }

    if (motor_running) {
      motorWatchdog = setTimeout(() => {
        motorWatchdog = null;
        forceMotorStopped('no STOPPED report from actuator within 20 s');
      }, MOTOR_STATE_TTL_MS);
    }

    console.log(
      `[ESP32-ACTUATOR] Motor ${motor_state ?? (motor_running ? 'RUNNING' : 'STOPPED')}`
    );

    return res.json({
      status: 'ok',
    });
  } catch (err) {
    console.error(
      '[ESP32-ACTUATOR] Status error:',
      err.message
    );

    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});

// GET /api/reservoir
// Polled by App.jsx every 8 s, requires auth

app.get(
  '/api/reservoir',
  requireAuth,
  async (_req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM reservoir WHERE id = 1'
      );

      if (!result.rows[0]) {
        return res.json({
          water_ph: 6.2,
          tds: 850,
          clarity: 98,
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
  }
);

// GET /api/reservoir/log
// Last N raw readings

app.get(
  '/api/reservoir/log',
  requireAuth,
  async (req, res) => {
    const requestedLimit = parseInt(
      req.query.limit,
      10
    );

    const limit = Number.isFinite(requestedLimit)
      ? Math.min(
          Math.max(requestedLimit, 1),
          500
        )
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
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// CAMERA ROUTES
// ESP32-CAM
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Flow:
 *
 * 1. User presses Capture button
 *    → POST /api/camera/capture
 *    → sets flag
 *
 * 2. ESP32 sends next image
 *    → POST /api/camera/upload
 *
 * 3. Server replies immediately
 *
 * 4. Server runs ML service
 *
 * 5. Server broadcasts camera_image
 *    over WebSocket
 */

// ═════════════════════════════════════════════════════════════════════════════
// EXCEL EXPORT (requires login)
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/export/options
// What the Export dialog can offer: sheets, live row counts, nodes.

app.get('/api/export/options', requireAuth, async (_req, res) => {
  try {
    return res.json(await getExportOptions(pool));
  } catch (err) {
    console.error('[EXPORT] Options error:', err.message);

    return res.status(500).json({
      message: 'Could not read export options',
      error: err.message,
    });
  }
});

// GET /api/export/xlsx?sheets=&limit=&range=&from=&to=&node=
// Builds the designed workbook straight from the database.

app.get('/api/export/xlsx', requireAuth, async (req, res) => {
  const started = Date.now();

  try {
    const params = parseExportParams(req.query);
    const workbook = await buildWorkbook(pool, params, req.user);

    const stamp = new Date()
      .toLocaleString('sv-SE', { timeZone: process.env.EXPORT_TIMEZONE || 'Asia/Manila' })
      .replace(' ', '_')
      .replace(/:/g, '')
      .slice(0, 15);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="VertiFarmVision_${stamp}.xlsx"`
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    await workbook.xlsx.write(res);
    res.end();

    console.log(
      `[EXPORT] ${req.user?.email || 'user'} exported [${params.sheets.join(', ')}] ` +
      `limit=${params.limit} range=${params.range.key} node=${params.node || 'all'} ` +
      `in ${Date.now() - started} ms`
    );
  } catch (err) {
    console.error('[EXPORT] Failed:', err.message);

    if (res.headersSent) {
      return res.destroy();
    }

    return res.status(err.status || 500).json({
      message: err.status ? err.message : 'Export failed',
      error: err.message,
    });
  }
});

// GET /api/camera/command
// Polled by ESP32 every few seconds

app.get('/api/camera/command', (_req, res) => {
  const pending = cameraCommandPending;

  if (pending) {
    cameraCommandPending = false;

    console.log(
      '[CAMERA] Command polled by ESP32 — triggering capture'
    );
  }

  return res.json({
    camera_command: pending,
  });
});

// POST /api/camera/capture
// Frontend "Capture" button

app.post(
  '/api/camera/capture',
  requireAuth,
  (_req, res) => {
    cameraCommandPending = true;

    console.log(
      '[CAMERA] Capture command queued — ' +
      'ESP32 will pick it up on next poll'
    );

    return res.json({
      ok: true,
      message:
        'Camera capture command queued for ESP32',
    });
  }
);

// POST /api/camera/analyze
// Manual image upload from dashboard

app.post(
  '/api/camera/analyze',
  requireAuth,
  async (req, res) => {
    const {
      image_base64: imageBase64,
    } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        message: 'image_base64 is required',
      });
    }

    const mlResult =
      await predictPlantHealth(imageBase64);

    if (!mlResult) {
      return res.status(502).json({
        message:
          `ML service unreachable at ${ML_SERVICE_URL}. ` +
          'Is it running?',
      });
    }

    console.log(
      `[ML] Manual upload → ` +
      `${mlResult.label} (${mlResult.confidence}%)`
    );

    return res.json({
      mlResult,
    });
  }
);

// POST /api/camera/upload
// Called by ESP32-CAM; no auth token needed

app.post(
  '/api/camera/upload',
  async (req, res) => {
    const {
      image_base64: imageBase64,
      width,
      height,
      file_size: fileSize,
    } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        message: 'image_base64 is required',
      });
    }

    const capturedAt =
      new Date().toISOString();

    // Consume pending capture command
    const triggerCapture =
      cameraCommandPending;

    if (triggerCapture) {
      cameraCommandPending = false;

      console.log(
        '[CAMERA] Capture command dispatched to ESP32'
      );
    }

    // Answer ESP32 immediately.
    // Inference happens after the reply.
    res.json({
      status: 'ok',
      capturedAt,
      camera_command: triggerCapture,
    });

    try {
      const mlResult =
        await predictPlantHealth(
          imageBase64
        );

      // Broadcast image + ML result
      broadcast({
        type: 'camera_image',
        imageData:
          `data:image/jpeg;base64,${imageBase64}`,
        width: width ?? 320,
        height: height ?? 240,
        fileSize: fileSize ?? 0,
        capturedAt,
        mlResult,
      });

      console.log(
        `[ESP32-CAM] Image received — ` +
        `${width ?? 320}×${height ?? 240}px, ` +
        `${fileSize ?? 0} bytes @ ${capturedAt} | ` +
        `ML=${
          mlResult
            ? `${mlResult.label} (${mlResult.confidence}%)`
            : 'n/a'
        }`
      );
    } catch (err) {
      // ESP32 already received success response.
      console.error(
        '[ESP32-CAM] Post-upload processing error:',
        err.message
      );
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// NODE HISTORY / IRRIGATION LOG ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/nodes/:id/history

app.get(
  '/api/nodes/:id/history',
  requireAuth,
  async (req, res) => {
    const requestedLimit = parseInt(
      req.query.limit,
      10
    );

    const limit = Number.isFinite(requestedLimit)
      ? Math.min(
          Math.max(requestedLimit, 1),
          500
        )
      : 20;

    try {
      const result = await pool.query(
        `SELECT *
         FROM sensor_readings
         WHERE node_id = (
           SELECT node_id
           FROM nodes
           WHERE id = $1
         )
         ORDER BY recorded_at DESC
         LIMIT $2`,
        [
          req.params.id,
          limit,
        ]
      );

      return res.json(result.rows);
    } catch (err) {
      return res.status(500).json({
        message: 'Server error',
        error: err.message,
      });
    }
  }
);

// GET /api/nodes/:id/irrigation-log

app.get(
  '/api/nodes/:id/irrigation-log',
  requireAuth,
  async (req, res) => {
    const requestedLimit = parseInt(
      req.query.limit,
      10
    );

    const limit = Number.isFinite(requestedLimit)
      ? Math.min(
          Math.max(requestedLimit, 1),
          500
        )
      : 10;

    try {
      const result = await pool.query(
        `SELECT *
         FROM irrigation_log
         WHERE node_id = $1
         ORDER BY triggered_at DESC
         LIMIT $2`,
        [
          req.params.id,
          limit,
        ]
      );

      return res.json(result.rows);
    } catch (err) {
      return res.status(500).json({
        message: 'Server error',
        error: err.message,
      });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// DATABASE MIGRATION — water clarity (%)
// The reservoir used to store a 0-100 "turbidity index" (lower = better).
// It now stores real clarity % (higher = better) in a `clarity` column.
// Idempotent: safe to run on every start. Old rows are converted once with
// the same formula the old firmware used (index 0->100%, 50->85%, 100->70%).
// ═════════════════════════════════════════════════════════════════════════════

async function ensureClarityColumns() {
  try {
    await pool.query('ALTER TABLE reservoir     ADD COLUMN IF NOT EXISTS clarity NUMERIC(5,1)');
    await pool.query('ALTER TABLE reservoir_log ADD COLUMN IF NOT EXISTS clarity NUMERIC(5,1)');

    const backfill = (table) =>
      pool.query(
        `UPDATE ${table}
            SET clarity = GREATEST(0, LEAST(100, ROUND((100 - turbidity * 0.3)::numeric, 1)))
          WHERE clarity IS NULL AND turbidity IS NOT NULL`
      );
    const a = await backfill('reservoir');
    const b = await backfill('reservoir_log');

    console.log(
      `[DB] clarity columns ready (converted ${a.rowCount} live + ${b.rowCount} log rows from the old turbidity index)`
    );
  } catch (err) {
    console.error(
      '[DB] Could not add the clarity columns:', err.message,
      '\n     Run this once as the database owner:\n' +
      '       ALTER TABLE reservoir     ADD COLUMN IF NOT EXISTS clarity NUMERIC(5,1);\n' +
      '       ALTER TABLE reservoir_log ADD COLUMN IF NOT EXISTS clarity NUMERIC(5,1);'
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═════════════════════════════════════════════════════════════════════════════

const PORT =
  process.env.PORT || 3001;

// A "RUNNING" left over from before a restart can't be true anymore.
forceMotorStopped('server startup');

// Make sure the clarity columns exist before the ESP32 starts posting to them.
ensureClarityColumns().finally(() => {
  server.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        `🚀 Server running on http://0.0.0.0:${PORT}`
      );

      startAflcScheduler();
    }
  );
});