import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api/client";
import Icon from "./Icon";
import { METRICS, getStatus } from "../config/thresholds";

/**
 * <ExportButton nodeData={nodeData} reservoirData={reservoirData} />
 *
 * Opens an export dialog. The Excel workbook is built by the server straight from
 * the database (GET /api/export/xlsx), so it is NOT limited to what the dashboard
 * is currently showing. You choose:
 *   • which sheets to include (all, some, or just one)
 *   • how many rows per data sheet (100 … All)
 *   • a time range and an optional node filter
 *
 * A quick CSV of the on-screen values is still available as a secondary option.
 *
 * Optional props:
 *   className  – extra CSS classes for the header button (defaults to "btn ghost")
 *   label      – button text
 *   onExported – called after a successful export (e.g. to show a toast)
 */

// ─── Option lists ─────────────────────────────────────────────────────────────
const LIMITS = [100, 500, 1000, 5000, 10000];
const RANGES = [
  { value: "all", label: "All time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom dates…" },
];
// Sheets that are not row-based get a small tag instead of a row count.
const SHEET_TAGS = { summary: "overview", live: "snapshot", daily: "aggregated", ranges: "reference" };
const DATA_SHEETS = ["readings", "reservoir", "aflc", "irrigation"];

const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US"));

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function readError(err) {
  const data = err?.response?.data;
  try {
    if (data instanceof Blob) {
      const parsed = JSON.parse(await data.text());
      return parsed.message || parsed.error || "Export failed.";
    }
    if (data?.message) return data.message;
  } catch {
    /* fall through */
  }
  if (err?.code === "ECONNABORTED") return "The export took too long. Try a smaller row limit or time range.";
  if (err?.response?.status === 401) return "Your session has expired. Please sign in again.";
  return "Could not reach the server. Check your connection and try again.";
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function filenameFrom(headers) {
  const cd = headers?.["content-disposition"] || "";
  const m = /filename="?([^";]+)"?/i.exec(cd);
  return m ? m[1] : `VertiFarmVision_${new Date().toISOString().slice(0, 10)}.xlsx`;
}

// ─── Quick CSV (on-screen values only) ────────────────────────────────────────
function calculateAFLCDecision({ temperature, humidity, co2 }) {
  let score = 0;
  if (temperature > 28) score += 2; else if (temperature > 26) score += 1;
  if (humidity < 55) score += 2; else if (humidity < 65) score += 1; else if (humidity > 80) score -= 1;
  if (co2 > 1500) score += 1.5; else if (co2 > 1200) score += 0.5;
  if (score >= 3)   return { decision: "IRRIGATE", confidence: Math.min(95, 70 + score * 5) };
  if (score >= 1.5) return { decision: "MONITOR",  confidence: 60 };
  return              { decision: "OPTIMAL",  confidence: Math.min(95, 80 + Math.abs(score) * 3) };
}

function esc(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (...cells) => cells.map(esc).join(",");

function buildCSV(nodeData, reservoirData) {
  const ts = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
  const lines = [];
  lines.push("VertiFarmVision — Sensor Data Export (on-screen values)");
  lines.push(`Export Time,${esc(ts)}`);

  lines.push("\nNODE SENSOR READINGS\n");
  lines.push(row("Node", "Temperature (°C)", "Humidity (%)", "CO₂ (ppm)", "Light (lx)", "Last Irrigation", "Irrigation Status", "AFLC Decision", "AFLC Confidence (%)"));
  Object.entries(nodeData).forEach(([nodeName, d]) => {
    const aflc = calculateAFLCDecision(d);
    lines.push(row(nodeName.toUpperCase(), d.temperature, d.humidity, d.co2, Math.round(d.lux ?? 0), d.lastIrrigation ?? "—", d.irrigationStatus ?? "idle", aflc.decision, aflc.confidence));
  });

  lines.push("\nRESERVOIR READINGS\n");
  lines.push(row("Parameter", "Value", "Unit", "Status"));
  lines.push(row("Water pH", reservoirData.waterPH, "", getStatus("ph", reservoirData.waterPH).state === "ok" ? "Optimal" : "Out of range"));
  lines.push(row("TDS", reservoirData.tds, "ppm", getStatus("tds", reservoirData.tds).state === "ok" ? "Optimal" : "Out of range"));
  lines.push(row("Clarity", reservoirData.clarity, "%", getStatus("clarity", reservoirData.clarity).state === "ok" ? "Clear" : "Cloudy — check water"));
  lines.push(row("Water Level", reservoirData.waterLevelTriggered ? "LOW" : "Optimal", "", reservoirData.waterLevelTriggered ? "⚠ REFILL REQUIRED" : "OK"));
  lines.push(row("Motor State", reservoirData.motorState, "", reservoirData.motorRunning ? "Running" : "Idle"));

  lines.push("\nOPTIMAL RANGES REFERENCE\n");
  lines.push(row("Parameter", "Min", "Max", "Unit"));
  ["temperature", "humidity", "co2", "lux", "ph", "tds", "clarity"].forEach((k) => {
    const m = METRICS[k];
    lines.push(row(m.label, m.optimal[0], m.optimal[1], m.unit));
  });
  return lines.join("\n");
}

function downloadCSV(csv, filename) {
  saveBlob(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }), filename);
}

// ─── Dialog ───────────────────────────────────────────────────────────────────
function ExportDialog({ nodeData, reservoirData, onClose, onExported }) {
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [limit, setLimit] = useState("1000");
  const [range, setRange] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [node, setNode] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);

  const loadOptions = useCallback(async () => {
    setLoadError("");
    setOptions(null);
    try {
      const { data } = await api.get("/export/options");
      setOptions(data);
      setSelected(new Set(data.sheets.map((s) => s.key))); // everything selected by default
    } catch (err) {
      setLoadError(await readError(err));
    }
  }, []);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  // Esc closes (unless a download is running); focus the dialog on open
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const toggle = (key) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const sheets = options?.sheets ?? [];
  const allOn = sheets.length > 0 && selected.size === sheets.length;
  const maxRows = options?.maxRows ?? 25000;

  const dateProblem = useMemo(() => {
    if (range !== "custom") return "";
    if (!from && !to) return "Pick a start and/or end date.";
    if (from && to && from > to) return "The start date is after the end date.";
    return "";
  }, [range, from, to]);

  // Rough size estimate (unfiltered counts, so this is an upper bound)
  const estimate = useMemo(() => {
    const cap = limit === "all" ? maxRows : Number(limit);
    return sheets
      .filter((s) => selected.has(s.key) && DATA_SHEETS.includes(s.key))
      .reduce((sum, s) => sum + Math.min(s.total ?? 0, cap), 0);
  }, [sheets, selected, limit, maxRows]);

  const canExport = !busy && options && selected.size > 0 && !dateProblem;

  async function handleDownload() {
    if (!canExport) return;
    setBusy(true);
    setError("");
    try {
      const params = {
        sheets: allOn ? "all" : [...selected].join(","),
        limit,
        range,
      };
      if (range === "custom") {
        if (from) params.from = from;
        if (to) params.to = to;
      }
      if (node !== "all") params.node = node;

      const res = await api.get("/export/xlsx", { params, responseType: "blob", timeout: 180000 });
      saveBlob(res.data, filenameFrom(res.headers));
      onExported?.();
      onClose();
    } catch (err) {
      setError(await readError(err));
    } finally {
      setBusy(false);
    }
  }

  function handleCsv() {
    if (!nodeData || !reservoirData) return;
    downloadCSV(buildCSV(nodeData, reservoirData), `VertiFarmVision_${new Date().toISOString().slice(0, 10)}.csv`);
    onExported?.();
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div
        className="modal-content export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="export-head">
          <div>
            <h3 id="export-title">Export to Excel</h3>
            <p>A designed workbook, read straight from the farm database.</p>
          </div>
          <button type="button" className="export-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="export-body">
          {loadError ? (
            <div className="export-error" role="alert">
              <span>{loadError}</span>
              <button type="button" className="btn ghost sm" onClick={loadOptions}>Retry</button>
            </div>
          ) : !options ? (
            <div className="export-loading" aria-live="polite">
              <Icon name="loader" size={18} /> Reading what's in the database…
            </div>
          ) : (
            <>
              <section aria-labelledby="export-sheets-h">
                <div className="export-section-head">
                  <h4 id="export-sheets-h">Sheets</h4>
                  <div className="export-quick">
                    <button type="button" onClick={() => setSelected(new Set(sheets.map((s) => s.key)))} disabled={allOn}>Select all</button>
                    <span aria-hidden="true">·</span>
                    <button type="button" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Select none</button>
                  </div>
                </div>

                <ul className="export-sheets">
                  {sheets.map((s) => {
                    const on = selected.has(s.key);
                    return (
                      <li key={s.key}>
                        <label className={`export-sheet${on ? " is-on" : ""}`}>
                          <input type="checkbox" checked={on} onChange={() => toggle(s.key)} />
                          <span className="export-sheet-main">
                            <strong>{s.label}</strong>
                            <small>{s.description}</small>
                          </span>
                          {s.total !== null ? (
                            <span className="export-badge" title={s.first ? `${s.first.slice(0, 10)} → ${s.last.slice(0, 10)}` : "No records"}>
                              {fmt(s.total)} rows
                            </span>
                          ) : (
                            <span className="export-badge tag">{SHEET_TAGS[s.key]}</span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section aria-labelledby="export-scope-h">
                <div className="export-section-head"><h4 id="export-scope-h">How much</h4></div>
                <div className="export-grid">
                  <label className="export-field">
                    <span>Rows per data sheet</span>
                    <select value={limit} onChange={(e) => setLimit(e.target.value)}>
                      {LIMITS.map((n) => <option key={n} value={String(n)}>Latest {fmt(n)}</option>)}
                      <option value="all">All (up to {fmt(maxRows)})</option>
                    </select>
                  </label>

                  <label className="export-field">
                    <span>Time range</span>
                    <select value={range} onChange={(e) => setRange(e.target.value)}>
                      {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </label>

                  <label className="export-field">
                    <span>Node</span>
                    <select value={node} onChange={(e) => setNode(e.target.value)}>
                      <option value="all">All nodes</option>
                      {options.nodes.map((n) => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}
                    </select>
                  </label>
                </div>

                {range === "custom" && (
                  <div className="export-grid export-dates">
                    <label className="export-field">
                      <span>From</span>
                      <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                    </label>
                    <label className="export-field">
                      <span>To</span>
                      <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                    </label>
                  </div>
                )}

                <p className={`export-hint${dateProblem ? " is-warn" : ""}`} aria-live="polite">
                  {dateProblem
                    ? dateProblem
                    : selected.size === 0
                      ? "Select at least one sheet to export."
                      : `Up to ${fmt(estimate)} data rows across the selected sheets. Daily Summary always covers every record in the range.`}
                </p>
              </section>
            </>
          )}

          {error && <div className="export-error" role="alert"><span>{error}</span></div>}
        </div>

        <footer className="export-actions">
          <button
            type="button"
            className="btn ghost sm export-csv"
            onClick={handleCsv}
            disabled={busy || !nodeData || !reservoirData}
            title="Download the values currently shown on the dashboard as a simple CSV"
          >
            Quick CSV (on screen)
          </button>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={handleDownload} disabled={!canExport}>
            <Icon name={busy ? "loader" : "download"} size={16} />
            {busy ? "Building workbook…" : "Download .xlsx"}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Header button ────────────────────────────────────────────────────────────
export default function ExportButton({
  nodeData,
  reservoirData,
  className = "btn ghost",
  label = "Export data",
  onExported = null,
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        className={className}
        onClick={() => setOpen(true)}
        title="Export farm data to an Excel workbook"
        aria-haspopup="dialog"
      >
        <Icon name="download" size={16} />
        <span className="btn-label">{label}</span>
      </button>
      {open && (
        <ExportDialog
          nodeData={nodeData}
          reservoirData={reservoirData}
          onClose={close}
          onExported={onExported}
        />
      )}
    </>
  );
}
