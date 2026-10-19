/**
 * ═══════════════════════════════════════════════════════════════════════════
 * exportXlsx.js — designed Excel export, read straight from PostgreSQL
 *
 *   npm install exceljs
 *
 * Used by server.js:
 *   GET /api/export/options   -> what can be exported (sheets, row counts, nodes)
 *   GET /api/export/xlsx      -> the workbook
 *       ?sheets=summary,readings,aflc   (omit or "all" = every sheet)
 *       &limit=1000                     (rows per data sheet, or "all")
 *       &range=all|24h|7d|30d|90d|custom   (+ &from=YYYY-MM-DD&to=YYYY-MM-DD)
 *       &node=NODE-01                   (omit or "all" = every node)
 *
 * The data comes from the database at export time, NOT from what the
 * dashboard happens to be showing. User accounts / passwords are never exported.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const ExcelJS = require('exceljs');

// ── Settings (override with .env) ────────────────────────────────────────────
const TZ = /^[A-Za-z0-9_\/+\-]{1,64}$/.test(process.env.EXPORT_TIMEZONE || '')
  ? process.env.EXPORT_TIMEZONE
  : 'Asia/Manila';
const TZ_SQL = `'${TZ}'`; // validated above, safe to inline
const MAX_ROWS = Math.max(1000, parseInt(process.env.EXPORT_MAX_ROWS, 10) || 25000);
const DEFAULT_LIMIT = 1000;

// ── Look & feel (mirrors the dashboard's emerald theme) ──────────────────────
const FONT = 'Arial';
const C = {
  deep: '0E2A1F', brand: '0C7A5A', brandInk: '075039', brandSoft: 'DFF2E8',
  surface: 'FFFFFF', surface2: 'F6FAF7', surface3: 'E9F1EA', border: 'D9E5DB',
  text: '12241A', muted: '587062',
  successFg: '1E7434', successBg: 'E2F3E5',
  warnFg: '9A5A08', warnBg: 'FDF0DC',
  dangerFg: 'C22F39', dangerBg: 'FBE7E9',
  infoFg: '1F5DB5', infoBg: 'E5EDFA',
};
const argb = (hex) => ({ argb: 'FF' + hex });
const solid = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: argb(hex), bgColor: argb(hex) });
const HEADER_ROW = 4;
const DATE_FMT = 'yyyy-mm-dd hh:mm:ss';

// Keep in sync with src/config/thresholds.js (the dashboard's single source of truth).
const METRICS = {
  temperature: { label: 'Temperature', unit: '°C',  dec: 1, optimal: [22, 26],      source: 'Air temperature (SHT31 + SCD41 blend)' },
  humidity:    { label: 'Humidity',    unit: '%',   dec: 1, optimal: [60, 75],      source: 'Relative humidity (SHT31 + SCD41 blend)' },
  co2:         { label: 'CO₂',         unit: 'ppm', dec: 0, optimal: [400, 1200],   source: 'Sensirion SCD41' },
  lux:         { label: 'Light',       unit: 'lx',  dec: 1, optimal: [5000, 80000], source: 'BH1750' },
  ph:          { label: 'Water pH',    unit: '',    dec: 2, optimal: [5.5, 7.0],    source: 'Reservoir pH probe' },
  tds:         { label: 'TDS',         unit: 'ppm', dec: 0, optimal: [500, 1500],   source: 'Reservoir TDS probe' },
  clarity:     { label: 'Clarity',     unit: '%',   dec: 0, optimal: [85, 100],     source: 'Optical clarity sensor (% of clear-water reading)' },
};

const SHEETS = [
  { key: 'summary',    name: 'Summary',           tab: C.brand,    desc: 'KPIs, statistics and the settings used for this export' },
  { key: 'live',       name: 'Live Status',       tab: '2FA876',   desc: 'Current state of every node and the reservoir' },
  { key: 'daily',      name: 'Daily Summary',     tab: C.infoFg,   desc: 'Per-day averages and counts, aggregated in the database' },
  { key: 'readings',   name: 'Sensor Readings',   tab: '12935F',   desc: 'Air-sensor history: temperature, humidity, CO₂, light',  table: 'sensor_readings' },
  { key: 'reservoir',  name: 'Reservoir History', tab: '2F6FD6',   desc: 'Water-quality history: pH, TDS, clarity, level, motor', table: 'reservoir_log' },
  { key: 'aflc',       name: 'AFLC Decisions',    tab: C.warnFg,   desc: 'Every irrigation decision the AFLC engine made',          table: 'aflc_decisions' },
  { key: 'irrigation', name: 'Irrigation Log',    tab: C.dangerFg, desc: 'Every irrigation event and what triggered it',            table: 'irrigation_log' },
  { key: 'ranges',     name: 'Optimal Ranges',    tab: C.muted,    desc: 'Reference ranges used for highlighting' },
];
const SHEET_BY_KEY = Object.fromEntries(SHEETS.map((s) => [s.key, s]));

// ═════════════════════════════════════════════════════════════════════════════
// Small helpers
// ═════════════════════════════════════════════════════════════════════════════

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "2026-10-11 20:42:00" (already converted to local time in SQL) -> Date whose UTC fields = that wall-clock time. */
function parseLocal(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
}

const localTs = (col) => `to_char(${col} AT TIME ZONE ${TZ_SQL}, 'YYYY-MM-DD HH24:MI:SS')`;
const localDay = (col) => `to_char(${col} AT TIME ZONE ${TZ_SQL}, 'YYYY-MM-DD')`;

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const fmtInt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));

function tzOffsetLabel() {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    return part ? part.value.replace('GMT', 'UTC') : '';
  } catch {
    return '';
  }
}

function statusOf(key, v) {
  const m = METRICS[key];
  if (v === null || v === undefined) return { label: 'No data', tone: 'muted' };
  const [lo, hi] = m.optimal;
  if (v < lo) return { label: 'Low', tone: 'info' };
  const over = m.maxExclusive ? v >= hi : v > hi;
  if (over) return { label: 'High', tone: 'warn' };
  return { label: 'Optimal', tone: 'success' };
}

function rangeText(key) {
  const m = METRICS[key];
  const [lo, hi] = m.optimal;
  const f = (v) => Number(v).toLocaleString('en-US');
  const u = m.unit ? ` ${m.unit}` : '';
  return m.maxExclusive && lo === 0 ? `< ${f(hi)}${u}` : `${f(lo)}–${f(hi)}${u}`;
}

const TONES = {
  success: { fg: C.successFg, bg: C.successBg },
  warn:    { fg: C.warnFg,    bg: C.warnBg },
  danger:  { fg: C.dangerFg,  bg: C.dangerBg },
  info:    { fg: C.infoFg,    bg: C.infoBg },
  muted:   { fg: C.muted,     bg: C.surface2 },
};

// ═════════════════════════════════════════════════════════════════════════════
// Parameters
// ═════════════════════════════════════════════════════════════════════════════

const RANGE_PRESETS = {
  '24h': { since: '24 hours', label: 'Last 24 hours' },
  '7d':  { since: '7 days',   label: 'Last 7 days' },
  '30d': { since: '30 days',  label: 'Last 30 days' },
  '90d': { since: '90 days',  label: 'Last 90 days' },
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseExportParams(q = {}) {
  // Sheets
  const allKeys = SHEETS.map((s) => s.key);
  let requested;
  if (q.sheets === undefined || q.sheets === 'all') requested = allKeys;
  else if (q.sheets === 'none' || q.sheets === '') requested = [];
  else requested = String(q.sheets).split(',').map((s) => s.trim()).filter(Boolean);

  const bad = requested.filter((k) => !SHEET_BY_KEY[k]);
  if (bad.length) throw httpError(400, `Unknown sheet: ${bad.join(', ')}`);
  const sheets = allKeys.filter((k) => requested.includes(k)); // canonical order
  if (!sheets.length) throw httpError(400, 'Select at least one sheet to export.');

  // Row limit
  let limit;
  let limitAll = false;
  if (q.limit === 'all') {
    limit = MAX_ROWS;
    limitAll = true;
  } else {
    const n = parseInt(q.limit, 10);
    limit = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_ROWS) : DEFAULT_LIMIT;
  }

  // Time range
  const range = { key: 'all', label: 'All time', since: null, from: null, to: null };
  if (q.range && q.range !== 'all') {
    if (RANGE_PRESETS[q.range]) {
      range.key = q.range;
      range.since = RANGE_PRESETS[q.range].since;
      range.label = RANGE_PRESETS[q.range].label;
    } else if (q.range === 'custom') {
      const from = q.from && DATE_RE.test(q.from) ? q.from : null;
      const to = q.to && DATE_RE.test(q.to) ? q.to : null;
      if (!from && !to) throw httpError(400, 'Pick a start and/or end date for a custom range.');
      if (from && to && from > to) throw httpError(400, 'The start date is after the end date.');
      range.key = 'custom';
      range.from = from;
      range.to = to;
      range.label = `Custom: ${from || 'beginning'} → ${to || 'today'}`;
    } else {
      throw httpError(400, 'Unknown time range.');
    }
  }

  // Node
  let node = null;
  if (q.node && q.node !== 'all') {
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(q.node)) throw httpError(400, 'Invalid node.');
    node = q.node;
  }

  return { sheets, limit, limitAll, range, node };
}

/** WHERE clause + params for a time column and an optional node column. */
function makeFilter(p, tsExpr, nodeExpr) {
  const params = [];
  const where = [];
  if (p.range.since) {
    params.push(p.range.since);
    where.push(`${tsExpr} >= now() - $${params.length}::interval`);
  }
  if (p.range.from) {
    params.push(p.range.from);
    where.push(`${tsExpr} >= ($${params.length}::date)::timestamp AT TIME ZONE ${TZ_SQL}`);
  }
  if (p.range.to) {
    params.push(p.range.to);
    where.push(`${tsExpr} < (($${params.length}::date) + 1)::timestamp AT TIME ZONE ${TZ_SQL}`);
  }
  if (p.node && nodeExpr) {
    params.push(p.node);
    where.push(`${nodeExpr} = $${params.length}`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// ═════════════════════════════════════════════════════════════════════════════
// Options endpoint
// ═════════════════════════════════════════════════════════════════════════════

async function getExportOptions(pool) {
  const out = SHEETS.map((s) => ({ key: s.key, label: s.name, description: s.desc, total: null, first: null, last: null }));
  const tsCol = { sensor_readings: 'recorded_at', reservoir_log: 'recorded_at', aflc_decisions: 'created_at', irrigation_log: 'triggered_at' };

  for (const s of SHEETS.filter((x) => x.table)) {
    const col = tsCol[s.table];
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c, ${localTs(`MIN(${col})`)} AS first, ${localTs(`MAX(${col})`)} AS last FROM ${s.table}`
    );
    const row = out.find((o) => o.key === s.key);
    row.total = r.rows[0].c;
    row.first = r.rows[0].first;
    row.last = r.rows[0].last;
  }

  const nodes = await pool.query(`SELECT node_id, COALESCE(name, node_id) AS name FROM nodes ORDER BY id`);
  return {
    sheets: out,
    nodes: nodes.rows,
    maxRows: MAX_ROWS,
    defaultLimit: DEFAULT_LIMIT,
    timezone: TZ,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Data fetching (all straight from the database)
// ═════════════════════════════════════════════════════════════════════════════

async function fetchSeries(pool, p, spec) {
  const f = makeFilter(p, spec.tsExpr, spec.nodeExpr);
  const meta = await pool.query(
    `SELECT COUNT(*)::int AS c, ${localTs(`MIN(${spec.tsExpr})`)} AS first, ${localTs(`MAX(${spec.tsExpr})`)} AS last
     FROM ${spec.from} ${f.sql}`,
    f.params
  );
  const rows = await pool.query(
    `SELECT ${spec.select} FROM ${spec.from} ${f.sql} ORDER BY ${spec.tsExpr} DESC, ${spec.idExpr} DESC LIMIT ${p.limit}`,
    f.params
  );
  return { rows: rows.rows, total: meta.rows[0].c, first: meta.rows[0].first, last: meta.rows[0].last };
}

const fetchReadings = (pool, p) => fetchSeries(pool, p, {
  from: 'sensor_readings', tsExpr: 'recorded_at', nodeExpr: 'node_id', idExpr: 'id',
  select: `id, ${localTs('recorded_at')} AS t, node_id, temperature, humidity, co2, lux, soil_moisture, soil_ph`,
});

const fetchReservoir = (pool, p) => fetchSeries(pool, p, {
  from: 'reservoir_log', tsExpr: 'recorded_at', nodeExpr: null, idExpr: 'id',
  select: `id, ${localTs('recorded_at')} AS t, water_ph, tds, clarity, water_present, water_level_triggered,
           motor_running, motor_state, ph_voltage, ph_raw, tds_raw, turbidity_raw`,
});

const fetchAflc = (pool, p) => fetchSeries(pool, p, {
  from: 'aflc_decisions a JOIN nodes n ON n.id = a.node_id', tsExpr: 'a.created_at', nodeExpr: 'n.node_id', idExpr: 'a.id',
  select: `a.id, ${localTs('a.created_at')} AS t, n.node_id AS node, a.decision, a.confidence, a.ecl, a.chs, a.stress_score,
           a.demand_pct, a.demand_bracket, a.hold_delay_sec, a.pump_duration_sec, a.base_duration_sec,
           a.adaptive_gain_sec, a.condition_persisted_sec, a.reason, a.deviations`,
});

const fetchIrrigation = (pool, p) => fetchSeries(pool, p, {
  from: 'irrigation_log l JOIN nodes n ON n.id = l.node_id', tsExpr: 'l.triggered_at', nodeExpr: 'n.node_id', idExpr: 'l.id',
  select: `l.id, ${localTs('l.triggered_at')} AS t, n.node_id AS node, l.triggered_by`,
});

async function fetchLive(pool, p) {
  const params = [];
  let where = '';
  if (p.node) {
    params.push(p.node);
    where = 'WHERE node_id = $1';
  }
  const nodes = await pool.query(
    `SELECT id, node_id, name, layer_number, temperature, humidity, co2, lux, soil_moisture, soil_ph,
            irrigation_status, ${localTs('last_irrigation')} AS last_irrigation, is_active,
            ${localTs('updated_at')} AS updated_at
     FROM nodes ${where} ORDER BY id`,
    params
  );
  const res = await pool.query(
    `SELECT water_ph, tds, clarity, water_level_triggered, motor_running, motor_state,
            ${localTs('updated_at')} AS updated_at
     FROM reservoir WHERE id = 1`
  );
  return { nodes: nodes.rows, reservoir: res.rows[0] || null };
}

async function fetchDistribution(pool, p) {
  const out = {};
  const fa = makeFilter(p, 'a.created_at', 'n.node_id');
  const dec = await pool.query(
    `SELECT COALESCE(a.decision, 'UNKNOWN') AS k, COUNT(*)::int AS c
     FROM aflc_decisions a JOIN nodes n ON n.id = a.node_id ${fa.sql} GROUP BY 1`,
    fa.params
  );
  out.decisions = Object.fromEntries(dec.rows.map((r) => [r.k, r.c]));

  const fi = makeFilter(p, 'l.triggered_at', 'n.node_id');
  const trig = await pool.query(
    `SELECT COALESCE(l.triggered_by, 'unknown') AS k, COUNT(*)::int AS c
     FROM irrigation_log l JOIN nodes n ON n.id = l.node_id ${fi.sql} GROUP BY 1 ORDER BY c DESC`,
    fi.params
  );
  out.triggers = trig.rows;
  return out;
}

async function fetchDaily(pool, p) {
  const days = new Map();
  const get = (d) => {
    if (!days.has(d)) days.set(d, { day: d });
    return days.get(d);
  };

  const fr = makeFilter(p, 'recorded_at', 'node_id');
  const r1 = await pool.query(
    `SELECT ${localDay('recorded_at')} AS d, COUNT(*)::int AS n, AVG(temperature) AS t, AVG(humidity) AS h,
            AVG(co2) AS c, AVG(lux) AS l
     FROM sensor_readings ${fr.sql} GROUP BY 1`,
    fr.params
  );
  r1.rows.forEach((r) => Object.assign(get(r.d), { readings: r.n, temperature: num(r.t), humidity: num(r.h), co2: num(r.c), lux: num(r.l) }));

  const fv = makeFilter(p, 'recorded_at', null);
  const r2 = await pool.query(
    `SELECT ${localDay('recorded_at')} AS d, COUNT(*)::int AS n, AVG(tds) AS tds, AVG(water_ph) AS ph, AVG(clarity) AS cl
     FROM reservoir_log ${fv.sql} GROUP BY 1`,
    fv.params
  );
  r2.rows.forEach((r) => Object.assign(get(r.d), { resLogs: r.n, tds: num(r.tds), ph: num(r.ph), clarity: num(r.cl) }));

  const fa = makeFilter(p, 'a.created_at', 'n.node_id');
  const r3 = await pool.query(
    `SELECT ${localDay('a.created_at')} AS d,
            COUNT(*) FILTER (WHERE a.decision = 'IRRIGATE')::int AS irr,
            COUNT(*) FILTER (WHERE a.decision = 'MONITOR')::int AS mon,
            COUNT(*) FILTER (WHERE a.decision = 'OPTIMAL')::int AS opt
     FROM aflc_decisions a JOIN nodes n ON n.id = a.node_id ${fa.sql} GROUP BY 1`,
    fa.params
  );
  r3.rows.forEach((r) => Object.assign(get(r.d), { dIrr: r.irr, dMon: r.mon, dOpt: r.opt }));

  const fi = makeFilter(p, 'l.triggered_at', 'n.node_id');
  const r4 = await pool.query(
    `SELECT ${localDay('l.triggered_at')} AS d, COUNT(*)::int AS n
     FROM irrigation_log l JOIN nodes n ON n.id = l.node_id ${fi.sql} GROUP BY 1`,
    fi.params
  );
  r4.rows.forEach((r) => Object.assign(get(r.d), { events: r.n }));

  const all = [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  return { rows: all.slice(0, p.limit), total: all.length, first: all.length ? all[all.length - 1].day : null, last: all.length ? all[0].day : null };
}

// ═════════════════════════════════════════════════════════════════════════════
// Sheet writers
// ═════════════════════════════════════════════════════════════════════════════

function baseFont(extra = {}) {
  return { name: FONT, size: 10, color: argb(C.text), ...extra };
}

function writeBanner(ws, ncols, title, subtitle) {
  ws.mergeCells(1, 1, 1, ncols);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 16, bold: true, color: argb('FFFFFF') };
  t.fill = solid(C.deep);
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 34;

  ws.mergeCells(2, 1, 2, ncols);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, size: 9, color: argb(C.brandInk) };
  s.fill = solid(C.brandSoft);
  s.alignment = { vertical: 'middle', indent: 1, wrapText: true };
  ws.getRow(2).height = 28;

  ws.getRow(3).height = 6;
}

function cellAlign(c) {
  const horizontal = c.align || (c.type === 'num' ? 'right' : 'left');
  return { vertical: 'middle', horizontal, indent: horizontal === 'center' ? 0 : 1 };
}

/**
 * Writes a header row + data rows. Returns { first, last, ncols, cols }.
 * columnStyles=true applies number formats through the column (fast for big sheets).
 */
function writeTable(ws, startRow, allCols, rows, { columnStyles = true } = {}) {
  const cols = allCols.filter((c) => !(c.hideIfEmpty && rows.every((r) => r[c.key] === null || r[c.key] === undefined)));

  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(col.width || 0, c.width || 12);
    if (columnStyles) {
      col.style = {
        font: baseFont(),
        alignment: cellAlign(c),
        numFmt: c.fmt || (c.type === 'date' ? DATE_FMT : undefined),
        border: { bottom: { style: 'hair', color: argb(C.border) } },
      };
    }
  });

  if (startRow === HEADER_ROW) {
    const total = cols.reduce((a, c) => a + (c.width || 12), 0);
    const sub = ws.getCell(2, 1).value;
    if (typeof sub === 'string') {
      const perLine = Math.max(30, Math.floor(total * 1.2));
      ws.getRow(2).height = Math.max(24, 13 * Math.ceil(sub.length / perLine) + 8);
    }
  }

  const hr = ws.getRow(startRow);
  hr.height = 30;
  cols.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, size: 10, bold: true, color: argb('FFFFFF') };
    cell.fill = solid(C.brand);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.numFmt = 'General';
    cell.border = { bottom: { style: 'medium', color: argb(C.deep) } };
  });

  let r = startRow;
  for (const row of rows) {
    r += 1;
    const wr = ws.getRow(r);
    cols.forEach((c, i) => {
      const v = row[c.key];
      const cell = wr.getCell(i + 1);
      cell.value = v === undefined ? null : v;
      if (!columnStyles) {
        cell.font = baseFont();
        cell.alignment = cellAlign(c);
        cell.border = { bottom: { style: 'hair', color: argb(C.border) } };
        if (c.fmt) cell.numFmt = c.fmt;
        else if (c.type === 'date') cell.numFmt = DATE_FMT;
      }
    });
  }
  return { first: startRow + 1, last: r, ncols: cols.length, cols };
}

function emptyState(ws, row, ncols, text) {
  ws.mergeCells(row, 1, row, ncols);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: FONT, size: 10, italic: true, color: argb(C.muted) };
  c.alignment = { horizontal: 'center', vertical: 'middle' };
  c.fill = solid(C.surface2);
  ws.getRow(row).height = 26;
}

let cfPriority = 1;
const nextPriority = () => cfPriority++;

function cfStyle(fg, bg, bold = false) {
  return { font: { color: argb(fg), bold }, fill: { type: 'pattern', pattern: 'solid', fgColor: argb(bg), bgColor: argb(bg) } };
}

/** Optimal-range shading for one column of a table. */
function addRangeShading(ws, ref, key) {
  const m = METRICS[key];
  const [lo, hi] = m.optimal;
  const tl = ref.split(':')[0]; // formulas are relative to the top-left cell of the range
  const rules = [];
  // ISNUMBER guard: an empty cell counts as 0 in Excel and would be wrongly shaded "below optimal".
  if (lo > 0) rules.push({ type: 'expression', formulae: [`AND(ISNUMBER(${tl}),${tl}<${lo})`], style: cfStyle(C.infoFg, C.infoBg), priority: nextPriority() });
  rules.push({ type: 'expression', formulae: [`AND(ISNUMBER(${tl}),${tl}${m.maxExclusive ? '>=' : '>'}${hi})`], style: cfStyle(C.warnFg, C.warnBg), priority: nextPriority() });
  ws.addConditionalFormatting({ ref, rules });
}

function addZebra(ws, ref) {
  ws.addConditionalFormatting({
    ref,
    rules: [{
      type: 'expression',
      formulae: ['MOD(ROW(),2)=0'],
      style: { fill: { type: 'pattern', pattern: 'solid', fgColor: argb(C.surface2), bgColor: argb(C.surface2) } },
      priority: nextPriority(),
    }],
  });
}

function addTextShading(ws, ref, map) {
  const rules = Object.entries(map).map(([text, tone]) => ({
    type: 'cellIs', operator: 'equal', formulae: [`"${text}"`],
    style: cfStyle(TONES[tone].fg, TONES[tone].bg, true), priority: nextPriority(),
  }));
  ws.addConditionalFormatting({ ref, rules });
}

function addDataBar(ws, ref, hex, min = null, max = null) {
  ws.addConditionalFormatting({
    ref,
    rules: [{
      type: 'dataBar', priority: nextPriority(), gradient: false, minLength: 0, maxLength: 100, border: false,
      cfvo: [min === null ? { type: 'min' } : { type: 'num', value: min }, max === null ? { type: 'max' } : { type: 'num', value: max }],
      color: argb(hex),
    }],
  });
}

function addColorScale(ws, ref, hexLow, hexHigh) {
  ws.addConditionalFormatting({
    ref,
    rules: [{ type: 'colorScale', priority: nextPriority(), cfvo: [{ type: 'min' }, { type: 'max' }], color: [argb(hexLow), argb(hexHigh)] }],
  });
}

function finishDataSheet(ws, t, ncols, landscape = true) {
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }];
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: ncols } };
  ws.pageSetup = {
    orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    paperSize: 9, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter = { oddFooter: '&L&8VertiFarmVision&C&8&A&R&8Page &P of &N' };
}

function subtitleFor(desc, shown, total, p, extra = '') {
  const tzl = `${TZ}${tzOffsetLabel() ? ` (${tzOffsetLabel()})` : ''}`;
  const limited = shown < total ? `Showing the latest ${fmtInt(shown)} of ${fmtInt(total)} matching rows` : `All ${fmtInt(total)} matching rows`;
  return `${desc}  ·  ${limited}, newest first  ·  ${p.range.label}  ·  Times in ${tzl}${extra}`;
}

const SHADING_LEGEND = '  ·  Shading: blue = below optimal, amber = above optimal';

// ── Sensor Readings ─────────────────────────────────────────────────────────
function buildReadings(ws, d, p) {
  const rows = d.rows.map((r) => ({
    t: parseLocal(r.t), node_id: r.node_id, temperature: num(r.temperature), humidity: num(r.humidity),
    co2: num(r.co2), lux: num(r.lux), soil_moisture: num(r.soil_moisture), soil_ph: num(r.soil_ph), id: r.id,
  }));
  const cols = [
    { key: 't', header: 'Recorded At', width: 20, type: 'date' },
    { key: 'node_id', header: 'Node', width: 12 },
    { key: 'temperature', header: 'Temperature (°C)', width: 15, type: 'num', fmt: '0.0' },
    { key: 'humidity', header: 'Humidity (%)', width: 13, type: 'num', fmt: '0.0' },
    { key: 'co2', header: 'CO₂ (ppm)', width: 12, type: 'num', fmt: '#,##0' },
    { key: 'lux', header: 'Light (lx)', width: 12, type: 'num', fmt: '#,##0.0' },
    { key: 'soil_moisture', header: 'Soil Moisture (%)', width: 15, type: 'num', fmt: '0.0', hideIfEmpty: true },
    { key: 'soil_ph', header: 'Soil pH', width: 10, type: 'num', fmt: '0.00', hideIfEmpty: true },
    { key: 'id', header: 'Record ID', width: 11, type: 'num', fmt: '0' },
  ];

  const n = cols.filter((c) => !(c.hideIfEmpty && rows.every((r) => r[c.key] === null))).length;
  writeBanner(ws, n, 'VertiFarmVision  ·  Sensor Readings', subtitleFor(SHEET_BY_KEY.readings.desc, rows.length, d.total, p, SHADING_LEGEND));
  const t = writeTable(ws, HEADER_ROW, cols, rows);
  const idx = Object.fromEntries(t.cols.map((c, i) => [c.key, i + 1]));

  if (!rows.length) emptyState(ws, t.first, t.ncols, 'No sensor readings match the selected range.');
  else {
    const range = (k) => `${colLetter(idx[k])}${t.first}:${colLetter(idx[k])}${t.last}`;
    for (const k of ['temperature', 'humidity', 'co2', 'lux']) addRangeShading(ws, range(k), k);
    addZebra(ws, `A${t.first}:${colLetter(t.ncols)}${t.last}`);
  }
  finishDataSheet(ws, t, t.ncols);
  return { ...t, idx, rows };
}

// ── Reservoir History ───────────────────────────────────────────────────────
function buildReservoir(ws, d, p) {
  const rows = d.rows.map((r) => ({
    t: parseLocal(r.t),
    water_ph: num(r.water_ph), tds: num(r.tds), clarity: num(r.clarity),
    level: r.water_level_triggered === true ? 'LOW' : r.water_level_triggered === false ? 'OK' : null,
    motor: r.motor_state || (r.motor_running === true ? 'RUNNING' : r.motor_running === false ? 'STOPPED' : null),
    ph_voltage: num(r.ph_voltage), ph_raw: num(r.ph_raw), tds_raw: num(r.tds_raw), turbidity_raw: num(r.turbidity_raw), id: r.id,
  }));
  const cols = [
    { key: 't', header: 'Recorded At', width: 20, type: 'date' },
    { key: 'water_ph', header: 'Water pH', width: 11, type: 'num', fmt: '0.00', hideIfEmpty: true },
    { key: 'tds', header: 'TDS (ppm)', width: 12, type: 'num', fmt: '#,##0', hideIfEmpty: true },
    { key: 'clarity', header: 'Clarity (%)', width: 13, type: 'num', fmt: '0.0', hideIfEmpty: true },
    { key: 'level', header: 'Water Level', width: 13, align: 'center', hideIfEmpty: true },
    { key: 'motor', header: 'Motor', width: 12, align: 'center', hideIfEmpty: true },
    { key: 'ph_voltage', header: 'pH Probe (V)', width: 13, type: 'num', fmt: '0.000', hideIfEmpty: true },
    { key: 'ph_raw', header: 'pH Raw', width: 11, type: 'num', fmt: '0.0000', hideIfEmpty: true },
    { key: 'tds_raw', header: 'TDS Raw', width: 11, type: 'num', fmt: '0.0000', hideIfEmpty: true },
    { key: 'turbidity_raw', header: 'Turbidity Probe (V)', width: 17, type: 'num', fmt: '0.0000', hideIfEmpty: true },
    { key: 'id', header: 'Record ID', width: 11, type: 'num', fmt: '0' },
  ];
  const n = cols.filter((c) => !(c.hideIfEmpty && rows.every((r) => r[c.key] === null))).length;
  writeBanner(ws, n, 'VertiFarmVision  ·  Reservoir History',
    subtitleFor(SHEET_BY_KEY.reservoir.desc, rows.length, d.total, p, SHADING_LEGEND + '  ·  Node filter does not apply (one shared reservoir)'));
  const t = writeTable(ws, HEADER_ROW, cols, rows);
  const idx = Object.fromEntries(t.cols.map((c, i) => [c.key, i + 1]));

  if (!rows.length) emptyState(ws, t.first, t.ncols, 'No reservoir records match the selected range.');
  else {
    const range = (k) => `${colLetter(idx[k])}${t.first}:${colLetter(idx[k])}${t.last}`;
    if (idx.water_ph) addRangeShading(ws, range('water_ph'), 'ph');
    if (idx.tds) addRangeShading(ws, range('tds'), 'tds');
    if (idx.clarity) addRangeShading(ws, range('clarity'), 'clarity');
    if (idx.level) addTextShading(ws, range('level'), { LOW: 'danger', OK: 'success' });
    if (idx.motor) addTextShading(ws, range('motor'), { RUNNING: 'info' });
    addZebra(ws, `A${t.first}:${colLetter(t.ncols)}${t.last}`);
  }
  finishDataSheet(ws, t, t.ncols);
  return { ...t, idx, rows };
}

// ── AFLC Decisions ──────────────────────────────────────────────────────────
function devText(v) {
  if (!v || typeof v !== 'object') return null;
  const parts = Object.entries(v).map(([k, x]) => `${k} ${Number.isFinite(Number(x)) ? Number(x).toFixed(2) : x}`);
  return parts.length ? parts.join('  ·  ') : null;
}

function buildAflc(ws, d, p) {
  const rows = d.rows.map((r) => ({
    t: parseLocal(r.t), node: r.node, decision: r.decision, confidence: num(r.confidence), ecl: r.ecl, chs: r.chs,
    stress_score: num(r.stress_score), demand_pct: num(r.demand_pct), demand_bracket: num(r.demand_bracket),
    hold_delay_sec: num(r.hold_delay_sec), pump_duration_sec: num(r.pump_duration_sec), base_duration_sec: num(r.base_duration_sec),
    adaptive_gain_sec: num(r.adaptive_gain_sec), condition_persisted_sec: num(r.condition_persisted_sec),
    reason: r.reason, deviations: devText(r.deviations), id: r.id,
  }));
  const cols = [
    { key: 't', header: 'Decided At', width: 20, type: 'date' },
    { key: 'node', header: 'Node', width: 11 },
    { key: 'decision', header: 'Decision', width: 13, align: 'center' },
    { key: 'confidence', header: 'Confidence', width: 14, type: 'num', fmt: '0.0"%"' },
    { key: 'ecl', header: 'Environment (ECL)', width: 18, hideIfEmpty: true },
    { key: 'chs', header: 'Crop Health (CHS)', width: 17, hideIfEmpty: true },
    { key: 'stress_score', header: 'Stress Score', width: 12, type: 'num', fmt: '0.000', hideIfEmpty: true },
    { key: 'demand_pct', header: 'Demand (%)', width: 12, type: 'num', fmt: '0.0', hideIfEmpty: true },
    { key: 'demand_bracket', header: 'Demand Bracket', width: 14, type: 'num', fmt: '0', align: 'center', hideIfEmpty: true },
    { key: 'hold_delay_sec', header: 'Hold Delay (s)', width: 13, type: 'num', fmt: '#,##0', hideIfEmpty: true },
    { key: 'pump_duration_sec', header: 'Pump Run (s)', width: 12, type: 'num', fmt: '#,##0', hideIfEmpty: true },
    { key: 'base_duration_sec', header: 'Base Run (s)', width: 12, type: 'num', fmt: '#,##0', hideIfEmpty: true },
    { key: 'adaptive_gain_sec', header: 'Adaptive Gain (s)', width: 15, type: 'num', fmt: '0.0', hideIfEmpty: true },
    { key: 'condition_persisted_sec', header: 'Condition Persisted (s)', width: 20, type: 'num', fmt: '#,##0', hideIfEmpty: true },
    { key: 'reason', header: 'Reason', width: 64 },
    { key: 'deviations', header: 'Sensor Deviations', width: 46, hideIfEmpty: true },
    { key: 'id', header: 'Record ID', width: 11, type: 'num', fmt: '0' },
  ];
  const n = cols.filter((c) => !(c.hideIfEmpty && rows.every((r) => r[c.key] === null))).length;
  writeBanner(ws, n, 'VertiFarmVision  ·  AFLC Decisions',
    subtitleFor(SHEET_BY_KEY.aflc.desc, rows.length, d.total, p, '  ·  Colour: blue = IRRIGATE, amber = MONITOR, green = OPTIMAL'));
  const t = writeTable(ws, HEADER_ROW, cols, rows);
  const idx = Object.fromEntries(t.cols.map((c, i) => [c.key, i + 1]));

  if (!rows.length) emptyState(ws, t.first, t.ncols, 'No AFLC decisions match the selected range.');
  else {
    const range = (k) => `${colLetter(idx[k])}${t.first}:${colLetter(idx[k])}${t.last}`;
    addTextShading(ws, range('decision'), { IRRIGATE: 'info', MONITOR: 'warn', OPTIMAL: 'success' });
    addDataBar(ws, range('confidence'), '5CC9A0', 0, 100);
    addZebra(ws, `A${t.first}:${colLetter(t.ncols)}${t.last}`);
  }
  finishDataSheet(ws, t, t.ncols);
  return { ...t, idx, rows };
}

// ── Irrigation Log ──────────────────────────────────────────────────────────
function buildIrrigation(ws, d, p) {
  const rows = d.rows.map((r) => ({ t: parseLocal(r.t), node: r.node, triggered_by: r.triggered_by, id: r.id }));
  const cols = [
    { key: 't', header: 'Triggered At', width: 22, type: 'date' },
    { key: 'node', header: 'Node', width: 14 },
    { key: 'triggered_by', header: 'Triggered By', width: 18 },
    { key: 'id', header: 'Record ID', width: 12, type: 'num', fmt: '0' },
  ];
  writeBanner(ws, cols.length, 'VertiFarmVision  ·  Irrigation Log', subtitleFor(SHEET_BY_KEY.irrigation.desc, rows.length, d.total, p));
  const t = writeTable(ws, HEADER_ROW, cols, rows);
  if (!rows.length) emptyState(ws, t.first, t.ncols, 'No irrigation events match the selected range.');
  else addZebra(ws, `A${t.first}:${colLetter(t.ncols)}${t.last}`);
  finishDataSheet(ws, t, t.ncols, false);
  return { ...t, idx: Object.fromEntries(t.cols.map((c, i) => [c.key, i + 1])), rows };
}

// ── Daily Summary ───────────────────────────────────────────────────────────
function buildDaily(ws, d, p) {
  const rows = d.rows.map((r) => ({
    day: parseLocal(r.day), readings: r.readings ?? 0, temperature: r.temperature ?? null, humidity: r.humidity ?? null,
    co2: r.co2 ?? null, lux: r.lux ?? null, resLogs: r.resLogs ?? 0, tds: r.tds ?? null, ph: r.ph ?? null, clarity: r.clarity ?? null,
    dIrr: r.dIrr ?? 0, dMon: r.dMon ?? 0, dOpt: r.dOpt ?? 0, events: r.events ?? 0,
  }));
  const cols = [
    { key: 'day', header: 'Date', width: 19, type: 'date', fmt: 'ddd, yyyy-mm-dd', align: 'left' },
    { key: 'readings', header: 'Sensor Readings', width: 12, type: 'num', fmt: '#,##0' },
    { key: 'temperature', header: 'Avg Temp (°C)', width: 12, type: 'num', fmt: '0.0' },
    { key: 'humidity', header: 'Avg Humidity (%)', width: 13, type: 'num', fmt: '0.0' },
    { key: 'co2', header: 'Avg CO₂ (ppm)', width: 12, type: 'num', fmt: '#,##0' },
    { key: 'lux', header: 'Avg Light (lx)', width: 12, type: 'num', fmt: '#,##0.0' },
    { key: 'resLogs', header: 'Reservoir Logs', width: 12, type: 'num', fmt: '#,##0', hideIfEmpty: false },
    { key: 'tds', header: 'Avg TDS (ppm)', width: 12, type: 'num', fmt: '#,##0', hideIfEmpty: true },
    { key: 'ph', header: 'Avg Water pH', width: 12, type: 'num', fmt: '0.00', hideIfEmpty: true },
    { key: 'clarity', header: 'Avg Clarity (%)', width: 14, type: 'num', fmt: '0.0', hideIfEmpty: true },
    { key: 'dIrr', header: 'AFLC: IRRIGATE', width: 13, type: 'num', fmt: '#,##0' },
    { key: 'dMon', header: 'AFLC: MONITOR', width: 13, type: 'num', fmt: '#,##0' },
    { key: 'dOpt', header: 'AFLC: OPTIMAL', width: 13, type: 'num', fmt: '#,##0' },
    { key: 'events', header: 'Irrigation Events', width: 12, type: 'num', fmt: '#,##0' },
  ];
  const n = cols.filter((c) => !(c.hideIfEmpty && rows.every((r) => r[c.key] === null))).length;
  const tzl = `${TZ}${tzOffsetLabel() ? ` (${tzOffsetLabel()})` : ''}`;
  const shown = rows.length;
  writeBanner(ws, n, 'VertiFarmVision  ·  Daily Summary',
    `${SHEET_BY_KEY.daily.desc}  ·  ${shown < d.total ? `Latest ${fmtInt(shown)} of ${fmtInt(d.total)} days` : `${fmtInt(d.total)} days`}, newest first  ·  ${p.range.label}  ·  Days split at midnight ${tzl}  ·  Computed over every record, not just the rows shown on other sheets`);
  const t = writeTable(ws, HEADER_ROW, cols, rows);
  const idx = Object.fromEntries(t.cols.map((c, i) => [c.key, i + 1]));

  if (!rows.length) emptyState(ws, t.first, t.ncols, 'No data in the selected range.');
  else {
    const range = (k) => `${colLetter(idx[k])}${t.first}:${colLetter(idx[k])}${t.last}`;
    for (const k of ['temperature', 'humidity', 'co2', 'lux', 'tds', 'ph', 'clarity']) if (idx[k]) addColorScale(ws, range(k), 'FFFFFF', '8FD6B5');
    addDataBar(ws, range('readings'), 'B9D4F5');
    addDataBar(ws, range('dIrr'), '8FB8F0');
    addDataBar(ws, range('dMon'), 'F2C77A');
    addDataBar(ws, range('dOpt'), '8FD6B5');
    addDataBar(ws, range('events'), 'EBA0A6');
  }
  finishDataSheet(ws, t, t.ncols);
  return { ...t, idx, rows };
}

// ── Live Status ─────────────────────────────────────────────────────────────
function buildLive(ws, live, p) {
  const nodes = live.nodes.map((n) => ({
    node_id: n.node_id, name: n.name, layer: n.layer_number, temperature: num(n.temperature), humidity: num(n.humidity),
    co2: num(n.co2), lux: num(n.lux), soil_moisture: num(n.soil_moisture), soil_ph: num(n.soil_ph),
    irrigation: n.irrigation_status, last_irrigation: parseLocal(n.last_irrigation),
    active: n.is_active === true ? 'Yes' : n.is_active === false ? 'No' : null, updated: parseLocal(n.updated_at),
  }));
  const cols = [
    { key: 'node_id', header: 'Node', width: 14 },
    { key: 'name', header: 'Name', width: 21 },
    { key: 'layer', header: 'Layer', width: 9, type: 'num', fmt: '0', align: 'center' },
    { key: 'temperature', header: 'Temperature (°C)', width: 15, type: 'num', fmt: '0.0' },
    { key: 'humidity', header: 'Humidity (%)', width: 17, type: 'num', fmt: '0.0' },
    { key: 'co2', header: 'CO₂ (ppm)', width: 12, type: 'num', fmt: '#,##0' },
    { key: 'lux', header: 'Light (lx)', width: 12, type: 'num', fmt: '#,##0.0' },
    { key: 'soil_moisture', header: 'Soil Moisture (%)', width: 15, type: 'num', fmt: '0.0', hideIfEmpty: true },
    { key: 'soil_ph', header: 'Soil pH', width: 10, type: 'num', fmt: '0.00', hideIfEmpty: true },
    { key: 'irrigation', header: 'Irrigation', width: 13, align: 'center' },
    { key: 'last_irrigation', header: 'Last Irrigation', width: 20, type: 'date' },
    { key: 'active', header: 'Active', width: 9, align: 'center' },
    { key: 'updated', header: 'Last Update', width: 20, type: 'date' },
  ];
  const visible = cols.filter((c) => !(c.hideIfEmpty && nodes.every((r) => r[c.key] === null))).length;
  writeBanner(ws, visible, 'VertiFarmVision  ·  Live Status',
    `${SHEET_BY_KEY.live.desc}  ·  Snapshot taken at export time  ·  Shading: blue = below optimal, amber = above optimal`);

  // Block 1: nodes
  ws.getCell(HEADER_ROW - 1, 1).value = 'NODES';
  ws.getCell(HEADER_ROW - 1, 1).font = { name: FONT, size: 9, bold: true, color: argb(C.brandInk) };
  ws.getRow(HEADER_ROW - 1).height = 16;
  const t = writeTable(ws, HEADER_ROW, cols, nodes, { columnStyles: false });
  const idx = Object.fromEntries(t.cols.map((c, i) => [c.key, i + 1]));
  let end = t.last;
  if (!nodes.length) {
    emptyState(ws, t.first, t.ncols, 'No nodes found.');
    end = t.first;
  } else {
    const range = (k) => `${colLetter(idx[k])}${t.first}:${colLetter(idx[k])}${t.last}`;
    for (const k of ['temperature', 'humidity', 'co2', 'lux']) addRangeShading(ws, range(k), k);
    addTextShading(ws, range('irrigation'), { active: 'info' });
    addTextShading(ws, range('active'), { Yes: 'success', No: 'danger' });
  }

  // Block 2: reservoir
  const r = live.reservoir;
  const top = end + 3;
  ws.getCell(top - 1, 1).value = 'RESERVOIR';
  ws.getCell(top - 1, 1).font = { name: FONT, size: 9, bold: true, color: argb(C.brandInk) };
  ws.getRow(top - 1).height = 16;

  const val = (k) => (r ? num(r[k]) : null);
  const levelText = r ? (r.water_level_triggered ? 'LOW — refill required' : 'OK') : null;
  const motorText = r ? (r.motor_state || (r.motor_running ? 'RUNNING' : 'STOPPED')) : null;
  const resRows = [
    { param: 'Water pH', value: val('water_ph'), unit: '', fmt: '0.00', status: statusOf('ph', val('water_ph')), range: rangeText('ph') },
    { param: 'TDS', value: val('tds'), unit: 'ppm', fmt: '#,##0', status: statusOf('tds', val('tds')), range: rangeText('tds') },
    { param: 'Clarity', value: val('clarity'), unit: '%', fmt: '0.0', status: statusOf('clarity', val('clarity')), range: rangeText('clarity') },
    { param: 'Water Level', value: levelText, unit: '', status: r ? { label: r.water_level_triggered ? 'Refill' : 'OK', tone: r.water_level_triggered ? 'danger' : 'success' } : { label: 'No data', tone: 'muted' }, range: 'Float switch' },
    { param: 'Motor', value: motorText, unit: '', status: { label: r && r.motor_running ? 'Running' : 'Idle', tone: r && r.motor_running ? 'info' : 'muted' }, range: 'Actuator board' },
    { param: 'Last Update', value: r ? parseLocal(r.updated_at) : null, unit: '', fmt: DATE_FMT, status: { label: '', tone: 'muted' }, range: '' },
  ];
  const heads = ['Parameter', 'Value', 'Unit', 'Status', 'Optimal Range'];
  heads.forEach((h, i) => {
    const c = ws.getCell(top, i + 1);
    c.value = h;
    c.font = { name: FONT, size: 10, bold: true, color: argb('FFFFFF') };
    c.fill = solid(C.brand);
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'medium', color: argb(C.deep) } };
  });
  ws.getRow(top).height = 26;
  resRows.forEach((row, i) => {
    const rr = top + 1 + i;
    const cells = [row.param, row.value, row.unit, row.status.label, row.range];
    cells.forEach((v, j) => {
      const c = ws.getCell(rr, j + 1);
      c.value = v === undefined || v === null || v === '' ? (j === 1 ? '—' : null) : v;
      c.font = baseFont({ bold: j === 0 });
      c.alignment = { vertical: 'middle', horizontal: j === 1 ? 'right' : j >= 2 ? 'center' : 'left' };
      c.border = { bottom: { style: 'hair', color: argb(C.border) } };
      if (j === 1 && row.fmt) c.numFmt = row.fmt;
      if (j === 3) {
        const tone = TONES[row.status.tone];
        c.fill = solid(tone.bg);
        c.font = baseFont({ bold: true, color: argb(tone.fg) });
      }
    });
  });

  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  ws.headerFooter = { oddFooter: '&L&8VertiFarmVision&C&8&A&R&8Page &P of &N' };
  return { nodes, reservoir: r, nodeAvg: (k) => avg(nodes.filter((n) => n.active !== 'No').map((n) => n[k])) };
}

// ── Optimal Ranges ──────────────────────────────────────────────────────────
function buildRanges(ws) {
  const cols = [
    { key: 'label', header: 'Parameter', width: 18 },
    { key: 'unit', header: 'Unit', width: 9, align: 'center' },
    { key: 'min', header: 'Optimal Min', width: 13, type: 'num', fmt: '#,##0.0' },
    { key: 'max', header: 'Optimal Max', width: 13, type: 'num', fmt: '#,##0.0' },
    { key: 'rule', header: 'How it is judged', width: 42 },
    { key: 'source', header: 'Source', width: 38 },
  ];
  const rows = Object.values(METRICS).map((m) => ({
    label: m.label, unit: m.unit || '—', min: m.optimal[0], max: m.optimal[1],
    rule: m.maxExclusive ? `Optimal while below ${m.optimal[1].toLocaleString('en-US')}` : 'Optimal between min and max (inclusive)',
    source: m.source,
  }));
  writeBanner(ws, cols.length, 'VertiFarmVision  ·  Optimal Ranges',
    'The ranges used for shading and status labels in this workbook. They mirror the dashboard (config/thresholds.js).');
  const t = writeTable(ws, HEADER_ROW, cols, rows);
  addZebra(ws, `A${t.first}:F${t.last}`);

  const legend = [
    ['Below the optimal range', C.infoFg, C.infoBg],
    ['Above the optimal range', C.warnFg, C.warnBg],
    ['Inside the optimal range (no shading)', C.successFg, C.successBg],
  ];
  const lr = t.last + 2;
  ws.getCell(lr, 1).value = 'SHADING LEGEND';
  ws.getCell(lr, 1).font = { name: FONT, size: 9, bold: true, color: argb(C.brandInk) };
  legend.forEach(([text, fg, bg], i) => {
    ws.mergeCells(lr + 1 + i, 1, lr + 1 + i, 3);
    const c = ws.getCell(lr + 1 + i, 1);
    c.value = text;
    c.font = baseFont({ bold: true, color: argb(fg) });
    c.fill = solid(bg);
    c.alignment = { vertical: 'middle', indent: 1 };
  });
  finishDataSheet(ws, t, t.ncols, false);
}

// ── Summary ─────────────────────────────────────────────────────────────────
const NC = 14; // Summary grid: 14 columns

function avg(arr) {
  const v = arr.map(num).filter((x) => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function box(ws, r1, c1, r2, c2, { fill = null, border = C.border } = {}) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      if (fill) cell.fill = solid(fill);
      cell.border = {
        top: r === r1 ? { style: 'thin', color: argb(border) } : undefined,
        bottom: r === r2 ? { style: 'thin', color: argb(border) } : undefined,
        left: c === c1 ? { style: 'thin', color: argb(border) } : undefined,
        right: c === c2 ? { style: 'thin', color: argb(border) } : undefined,
      };
    }
  }
}

function section(ws, row, title) {
  ws.mergeCells(row, 1, row, NC);
  const c = ws.getCell(row, 1);
  c.value = title;
  c.font = { name: FONT, size: 10, bold: true, color: argb(C.brandInk) };
  c.alignment = { vertical: 'middle', indent: 0 };
  for (let i = 1; i <= NC; i++) ws.getCell(row, i).border = { bottom: { style: 'medium', color: argb(C.brand) } };
  ws.getRow(row).height = 22;
}

/** Merged cell helper: writes value/style into a [c1..c2] merge on one row. */
function mcell(ws, row, c1, c2, value, { font, fill, align = 'left', numFmt, border = true } = {}) {
  if (c2 > c1) ws.mergeCells(row, c1, row, c2);
  const cell = ws.getCell(row, c1);
  cell.value = value;
  cell.font = font || baseFont();
  cell.alignment = { vertical: 'middle', horizontal: align, wrapText: false, indent: align === 'left' ? 1 : 0 };
  if (numFmt) cell.numFmt = numFmt;
  for (let c = c1; c <= c2; c++) {
    const x = ws.getCell(row, c);
    if (fill) x.fill = solid(fill);
    if (border) x.border = { bottom: { style: 'hair', color: argb(C.border) } };
  }
  return cell;
}

function tableHead(ws, row, spans) {
  spans.forEach(([c1, c2, text, align]) => {
    mcell(ws, row, c1, c2, text, {
      font: { name: FONT, size: 9, bold: true, color: argb('FFFFFF') }, fill: C.brand, align: align || 'center', border: false,
    });
  });
  ws.getRow(row).height = 22;
}

function buildSummary(ws, ctx) {
  const { p, user, live, built, totals, dist } = ctx;
  for (let i = 1; i <= NC; i++) ws.getColumn(i).width = 11.5;

  const tzl = `${TZ}${tzOffsetLabel() ? ` (${tzOffsetLabel()})` : ''}`;
  const now = new Date().toLocaleString('en-PH', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });

  // Banner
  ws.mergeCells(1, 1, 1, NC);
  const b = ws.getCell(1, 1);
  b.value = 'VertiFarmVision  ·  Data Export';
  b.font = { name: FONT, size: 22, bold: true, color: argb('FFFFFF') };
  b.fill = solid(C.deep);
  b.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 46;
  ws.mergeCells(2, 1, 2, NC);
  const s2 = ws.getCell(2, 1);
  s2.value = `Generated ${now} (${tzl})  ·  by ${user?.email || 'unknown'}  ·  Read directly from the farm database`;
  s2.font = { name: FONT, size: 10, color: argb(C.brandInk) };
  s2.fill = solid(C.brandSoft);
  s2.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 24;
  ws.getRow(3).height = 10;

  let r = 4;

  // ── Live KPIs ──
  section(ws, r, 'LIVE STATUS  —  snapshot at export time');
  r += 1;
  ws.getRow(r).height = 8;
  r += 1;

  const nodesActive = live.nodes.filter((n) => n.is_active !== false);
  const avgOf = (k) => avg(nodesActive.map((n) => n[k]));
  const res = live.reservoir || {};
  const kpis = [
    { key: 'temperature', value: avgOf('temperature') },
    { key: 'humidity', value: avgOf('humidity') },
    { key: 'co2', value: avgOf('co2') },
    { key: 'lux', value: avgOf('lux') },
    { key: 'ph', value: num(res.water_ph) },
    { key: 'tds', value: num(res.tds) },
    { key: 'clarity', value: num(res.clarity) },
  ];
  kpis.forEach((k, i) => {
    const c1 = i * 2 + 1;
    const c2 = c1 + 1;
    const m = METRICS[k.key];
    const st = statusOf(k.key, k.value);
    const tone = TONES[st.tone];
    box(ws, r, c1, r + 2, c2, { fill: C.surface });
    mcell(ws, r, c1, c2, `${m.label.toUpperCase()}${m.unit ? `  (${m.unit})` : ''}`, {
      font: { name: FONT, size: 8, bold: true, color: argb(C.muted) }, align: 'center', border: false,
    });
    mcell(ws, r + 1, c1, c2, k.value === null ? '—' : k.value, {
      font: { name: FONT, size: 20, bold: true, color: argb(C.text) }, align: 'center',
      numFmt: m.dec ? `#,##0.${'0'.repeat(m.dec)}` : '#,##0', border: false,
    });
    mcell(ws, r + 2, c1, c2, `${st.label}  ·  ${rangeText(k.key)}`, {
      font: { name: FONT, size: 8, bold: true, color: argb(tone.fg) }, fill: tone.bg, align: 'center', border: false,
    });
    // box() ran first; re-apply the outline over the tone row
    box(ws, r, c1, r + 2, c2, {});
  });
  ws.getRow(r).height = 20;
  ws.getRow(r + 1).height = 40;
  ws.getRow(r + 2).height = 20;
  r += 3;

  const nodeUpd = live.nodes.map((n) => n.updated_at).filter(Boolean).sort().pop();
  mcell(ws, r, 1, NC,
    `Air values are the average of ${nodesActive.length} active node${nodesActive.length === 1 ? '' : 's'} (latest update ${nodeUpd || '—'}); water values come from the reservoir (latest update ${res.updated_at || '—'}). See the “Live Status” sheet for per-node detail.`,
    { font: { name: FONT, size: 8, italic: true, color: argb(C.muted) }, border: false });
  r += 2;

  // ── Export settings ──
  section(ws, r, 'EXPORT SETTINGS');
  r += 1;
  const limitLabel = p.limitAll ? `All rows (capped at ${fmtInt(MAX_ROWS)} per sheet)` : `Latest ${fmtInt(p.limit)} rows per data sheet`;
  const settings = [
    ['Time range', p.range.label],
    ['Row limit', limitLabel],
    ['Node filter', p.node ? `${p.node} only (reservoir is shared and not filtered)` : 'All nodes'],
    ['Sheets included', p.sheets.map((k) => SHEET_BY_KEY[k].name).join(', ')],
    ['Time zone', tzl],
  ];
  settings.forEach(([k, v], i) => {
    const rr = r + i;
    mcell(ws, rr, 1, 3, k, { font: baseFont({ bold: true, color: argb(C.muted) }), fill: C.surface2 });
    mcell(ws, rr, 4, NC, v);
  });
  r += settings.length + 1;

  // ── Data included ──
  const dataSheets = ['readings', 'reservoir', 'aflc', 'irrigation', 'daily'].filter((k) => built[k] || ctx.wantedButEmpty?.includes(k));
  const absolute = (key, colKey) => {
    const b2 = built[key];
    const col = colLetter(b2.idx[colKey]);
    const last = Math.max(b2.last, b2.first);
    return `'${SHEET_BY_KEY[key].name}'!$${col}$${b2.first}:$${col}$${last}`;
  };

  if (dataSheets.length) {
    section(ws, r, 'DATA INCLUDED');
    r += 1;
    tableHead(ws, r, [[1, 3, 'Sheet', 'left'], [4, 8, 'What it contains', 'left'], [9, 10, 'Rows exported'], [11, 12, 'In database*'], [13, 14, 'Coverage']]);
    r += 1;
    const incRows = [];
    dataSheets.forEach((k, i) => {
      const rr = r + i;
      const b2 = built[k];
      const tot = totals[k];
      const exported = b2.rows.length;
      mcell(ws, rr, 1, 3, SHEET_BY_KEY[k].name, { font: baseFont({ bold: true }) });
      mcell(ws, rr, 4, 8, SHEET_BY_KEY[k].desc, { font: baseFont({ color: argb(C.muted) }) });
      mcell(ws, rr, 9, 10, { formula: `COUNT(${absolute(k, k === 'daily' ? 'day' : 't')})`, result: exported }, { align: 'center', numFmt: '#,##0', font: baseFont({ bold: true }) });
      mcell(ws, rr, 11, 12, tot.total, { align: 'center', numFmt: '#,##0' });
      const cov = tot.first ? `${String(tot.first).slice(0, 10)} → ${String(tot.last).slice(0, 10)}` : 'No data';
      mcell(ws, rr, 13, 14, cov, { align: 'center', font: baseFont({ size: 8, color: argb(C.muted) }) });
      incRows.push(rr);
    });
    r += dataSheets.length;
    mcell(ws, r, 1, NC,
      '* Rows in the database that match the selected time range and node. When “Rows exported” is lower, the row limit trimmed the oldest records — raise the limit (or choose “All”) to export everything.',
      { font: { name: FONT, size: 8, italic: true, color: argb(C.muted) }, border: false });
    r += 2;
  }

  // ── Statistics ──
  const statDefs = [];
  if (built.readings) for (const k of ['temperature', 'humidity', 'co2', 'lux']) statDefs.push({ key: k, sheet: 'readings', col: k });
  if (built.reservoir) {
    for (const [k, col] of [['ph', 'water_ph'], ['tds', 'tds'], ['clarity', 'clarity']]) if (built.reservoir.idx[col]) statDefs.push({ key: k, sheet: 'reservoir', col });
  }
  if (statDefs.length) {
    section(ws, r, 'SENSOR STATISTICS  —  across the rows exported on the data sheets');
    r += 1;
    tableHead(ws, r, [[1, 3, 'Metric', 'left'], [4, 4, 'Unit'], [5, 6, 'Average'], [7, 8, 'Minimum'], [9, 10, 'Maximum'], [11, 12, 'Optimal range'], [13, 14, '% in range']]);
    r += 1;
    statDefs.forEach((sd, i) => {
      const rr = r + i;
      const m = METRICS[sd.key];
      const ref = absolute(sd.sheet, sd.col);
      const values = built[sd.sheet].rows.map((x) => x[sd.col]).filter((v) => v !== null && v !== undefined);
      const [lo, hi] = m.optimal;
      const inRange = values.filter((v) => v >= lo && (m.maxExclusive ? v < hi : v <= hi)).length;
      const fmt = m.dec ? `#,##0.${'0'.repeat(Math.max(m.dec, 1))}` : '#,##0.0';
      const critHi = m.maxExclusive ? '"<"' : '"<="';

      mcell(ws, rr, 1, 3, m.label, { font: baseFont({ bold: true }) });
      mcell(ws, rr, 4, 4, m.unit || '—', { align: 'center', font: baseFont({ color: argb(C.muted) }) });
      mcell(ws, rr, 5, 6, { formula: `IFERROR(AVERAGE(${ref}),"—")`, result: values.length ? values.reduce((a, b) => a + b, 0) / values.length : '—' }, { align: 'center', numFmt: fmt });
      mcell(ws, rr, 7, 8, { formula: `IF(COUNT(${ref})=0,"—",MIN(${ref}))`, result: values.length ? Math.min(...values) : '—' }, { align: 'center', numFmt: fmt });
      mcell(ws, rr, 9, 10, { formula: `IF(COUNT(${ref})=0,"—",MAX(${ref}))`, result: values.length ? Math.max(...values) : '—' }, { align: 'center', numFmt: fmt });
      mcell(ws, rr, 11, 12, rangeText(sd.key), { align: 'center', font: baseFont({ color: argb(C.muted) }) });
      mcell(ws, rr, 13, 14, {
        formula: `IF(COUNT(${ref})=0,"—",COUNTIFS(${ref},">="&${lo},${ref},${critHi}&${hi})/COUNT(${ref}))`,
        result: values.length ? inRange / values.length : '—',
      }, { align: 'center', numFmt: '0.0%', font: baseFont({ bold: true }) });
    });
    // % in range: green scale 0..100%
    ws.addConditionalFormatting({
      ref: `M${r}:M${r + statDefs.length - 1}`,
      rules: [{ type: 'colorScale', priority: nextPriority(), cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: [argb('FBE7E9'), argb('C9EBD5')] }],
    });
    r += statDefs.length + 1;
    mcell(ws, r, 1, NC,
      'Statistics are live formulas over the data sheets, so they update if you filter or edit those sheets’ values. “% in range” counts readings that fall inside the optimal range (see “Optimal Ranges”).',
      { font: { name: FONT, size: 8, italic: true, color: argb(C.muted) }, border: false });
    r += 2;
  }

  // ── AFLC distribution ──
  if (built.aflc) {
    section(ws, r, 'AFLC DECISIONS');
    r += 1;
    tableHead(ws, r, [[1, 3, 'Decision', 'left'], [4, 6, 'Exported rows'], [7, 9, 'Total in range*'], [10, 14, 'Share of exported rows']]);
    r += 1;
    const order = ['IRRIGATE', 'MONITOR', 'OPTIMAL'];
    const known = new Set(order);
    const others = Object.keys(dist.decisions).filter((k) => !known.has(k));
    const list = [...order, ...others];
    const exportedCounts = {};
    built.aflc.rows.forEach((x) => { exportedCounts[x.decision || 'UNKNOWN'] = (exportedCounts[x.decision || 'UNKNOWN'] || 0) + 1; });
    const decRef = absolute('aflc', 'decision');
    const first = r;
    const lastRow = r + list.length - 1;
    const sumExported = built.aflc.rows.length;
    list.forEach((k, i) => {
      const rr = r + i;
      const tone = { IRRIGATE: 'info', MONITOR: 'warn', OPTIMAL: 'success' }[k] || 'muted';
      mcell(ws, rr, 1, 3, k, { font: baseFont({ bold: true, color: argb(TONES[tone].fg) }), fill: TONES[tone].bg });
      mcell(ws, rr, 4, 6, { formula: `COUNTIF(${decRef},"${k}")`, result: exportedCounts[k] || 0 }, { align: 'center', numFmt: '#,##0', font: baseFont({ bold: true }) });
      mcell(ws, rr, 7, 9, dist.decisions[k] || 0, { align: 'center', numFmt: '#,##0' });
      mcell(ws, rr, 10, 14, { formula: `IF(SUM($D$${first}:$D$${lastRow})=0,0,D${rr}/SUM($D$${first}:$D$${lastRow}))`, result: sumExported ? (exportedCounts[k] || 0) / sumExported : 0 }, { align: 'left', numFmt: '0.0%' });
    });
    addDataBar(ws, `J${first}:J${lastRow}`, '5CC9A0', 0, 1);
    r += list.length;
    mcell(ws, r, 1, NC, '* Counted in the database across the whole selected range, regardless of the row limit.',
      { font: { name: FONT, size: 8, italic: true, color: argb(C.muted) }, border: false });
    r += 2;
  }

  // ── Irrigation by trigger ──
  if (built.irrigation) {
    section(ws, r, 'IRRIGATION EVENTS');
    r += 1;
    tableHead(ws, r, [[1, 3, 'Triggered by', 'left'], [4, 6, 'Events in range*']]);
    r += 1;
    if (!dist.triggers.length) {
      mcell(ws, r, 1, 6, 'No irrigation events in the selected range.', { font: baseFont({ italic: true, color: argb(C.muted) }) });
      r += 1;
    } else {
      dist.triggers.forEach((t, i) => {
        mcell(ws, r + i, 1, 3, t.k, { font: baseFont({ bold: true }) });
        mcell(ws, r + i, 4, 6, t.c, { align: 'center', numFmt: '#,##0' });
      });
      r += dist.triggers.length;
    }
    mcell(ws, r, 1, NC, '* Counted in the database across the whole selected range.', { font: { name: FONT, size: 8, italic: true, color: argb(C.muted) }, border: false });
    r += 2;
  }

  // ── Notes ──
  section(ws, r, 'NOTES');
  r += 1;
  [
    `All timestamps are in ${tzl}.`,
    'Shading on the data sheets follows the dashboard’s optimal ranges (see “Optimal Ranges”).',
    'User accounts and passwords are never included in an export.',
    'Empty columns (for example soil sensors that are not installed) are left out automatically.',
  ].forEach((t, i) => mcell(ws, r + i, 1, NC, `•  ${t}`, { font: baseFont({ color: argb(C.muted) }), border: false }));

  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 } };
  ws.headerFooter = { oddFooter: '&L&8VertiFarmVision&C&8&A&R&8Page &P of &N' };
}

// ═════════════════════════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════════════════════════

async function buildWorkbook(pool, p, user) {
  cfPriority = 1;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VertiFarmVision';
  wb.title = 'VertiFarmVision data export';
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  const want = (k) => p.sheets.includes(k);
  const sheets = {};
  for (const s of SHEETS) {
    if (want(s.key)) sheets[s.key] = wb.addWorksheet(s.name, { properties: { tabColor: argb(s.tab) }, views: [{ showGridLines: false }] });
  }

  // Fetch what's needed, straight from the database
  const jobs = {};
  if (want('readings')) jobs.readings = fetchReadings(pool, p);
  if (want('reservoir')) jobs.reservoir = fetchReservoir(pool, p);
  if (want('aflc')) jobs.aflc = fetchAflc(pool, p);
  if (want('irrigation')) jobs.irrigation = fetchIrrigation(pool, p);
  if (want('daily')) jobs.daily = fetchDaily(pool, p);
  if (want('live') || want('summary')) jobs.live = fetchLive(pool, p);
  if (want('summary') && (want('aflc') || want('irrigation'))) jobs.dist = fetchDistribution(pool, p);

  const keys = Object.keys(jobs);
  const results = await Promise.all(keys.map((k) => jobs[k]));
  const data = Object.fromEntries(keys.map((k, i) => [k, results[i]]));

  // Build data sheets first (Summary formulas need their cell ranges)
  const built = {};
  const totals = {};
  const note = (k) => { totals[k] = { total: data[k].total, first: data[k].first, last: data[k].last }; };
  if (data.readings)   { built.readings = buildReadings(sheets.readings, data.readings, p); note('readings'); }
  if (data.reservoir)  { built.reservoir = buildReservoir(sheets.reservoir, data.reservoir, p); note('reservoir'); }
  if (data.aflc)       { built.aflc = buildAflc(sheets.aflc, data.aflc, p); note('aflc'); }
  if (data.irrigation) { built.irrigation = buildIrrigation(sheets.irrigation, data.irrigation, p); note('irrigation'); }
  if (data.daily)      { built.daily = buildDaily(sheets.daily, data.daily, p); note('daily'); }
  if (want('live'))    buildLive(sheets.live, data.live, p);
  if (want('ranges'))  buildRanges(sheets.ranges);
  if (want('summary')) buildSummary(sheets.summary, { p, user, live: data.live, built, totals, dist: data.dist || { decisions: {}, triggers: [] } });

  return wb;
}

module.exports = { buildWorkbook, getExportOptions, parseExportParams, SHEETS };
