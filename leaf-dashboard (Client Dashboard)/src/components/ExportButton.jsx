import React, { useState } from "react";
import Icon from "./Icon";
import { METRICS, getStatus } from "../config/thresholds";

// ─── AFLC logic (mirrors App.jsx so the exported values match what the UI shows) ──
function calculateAFLCDecision({ temperature, humidity, co2 }) {
  let score = 0;
  if (temperature > 28) score += 2; else if (temperature > 26) score += 1;
  if (humidity < 55) score += 2; else if (humidity < 65) score += 1; else if (humidity > 80) score -= 1;
  if (co2 > 1500) score += 1.5; else if (co2 > 1200) score += 0.5;
  if (score >= 3)   return { decision: "IRRIGATE", confidence: Math.min(95, 70 + score * 5) };
  if (score >= 1.5) return { decision: "MONITOR",  confidence: 60 };
  return              { decision: "OPTIMAL",  confidence: Math.min(95, 80 + Math.abs(score) * 3) };
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
function esc(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}
function row(...cells)   { return cells.map(esc).join(","); }
function section(title)  { return `\n${title}\n`; }

function buildCSV(nodeData, reservoirData) {
  const now = new Date();
  const ts  = now.toLocaleString("en-PH", { timeZone: "Asia/Manila" });

  const lines = [];

  lines.push(`VertiFarmVision — Sensor Data Export`);
  lines.push(`Export Time,${esc(ts)}`);
  lines.push(`DB Status,Live`);

  // ── Node readings ──────────────────────────────────────────────────────────
  lines.push(section("NODE SENSOR READINGS"));
  lines.push(row("Node", "Temperature (°C)", "Humidity (%)", "CO₂ (ppm)", "Light (lx)", "Last Irrigation", "Irrigation Status", "AFLC Decision", "AFLC Confidence (%)"));

  Object.entries(nodeData).forEach(([nodeName, d]) => {
    const aflc = calculateAFLCDecision(d);
    lines.push(row(
      nodeName.toUpperCase(),
      d.temperature,
      d.humidity,
      d.co2,
      Math.round(d.lux ?? 0),
      d.lastIrrigation ?? "—",
      d.irrigationStatus ?? "idle",
      aflc.decision,
      aflc.confidence,
    ));
  });

  // ── Reservoir ──────────────────────────────────────────────────────────────
  lines.push(section("RESERVOIR READINGS"));
  lines.push(row("Parameter", "Value", "Unit", "Status"));
  lines.push(row("Water pH",    reservoirData.waterPH,    "",     getStatus("ph", reservoirData.waterPH).state === "ok" ? "Optimal" : "Out of range"));
  lines.push(row("TDS",         reservoirData.tds,        "ppm",  getStatus("tds", reservoirData.tds).state === "ok" ? "Optimal" : "Out of range"));
  lines.push(row("Turbidity",   reservoirData.turbidity,  "NTU",  getStatus("turbidity", reservoirData.turbidity).state === "ok" ? "Clear" : "Turbid — check water"));
  lines.push(row("Water Level", reservoirData.waterLevelTriggered ? "LOW" : "Optimal", "", reservoirData.waterLevelTriggered ? "⚠ REFILL REQUIRED" : "OK"));
  lines.push(row("Motor State", reservoirData.motorState, "",     reservoirData.motorRunning ? "Running" : "Idle"));

  // ── Optimal ranges reference ───────────────────────────────────────────────
  lines.push(section("OPTIMAL RANGES REFERENCE"));
  lines.push(row("Parameter", "Min", "Max", "Unit"));
  ["temperature", "humidity", "co2", "lux", "ph", "tds", "turbidity"].forEach((k) => {
    const m = METRICS[k];
    lines.push(row(m.label, k === "turbidity" ? "" : m.optimal[0], m.optimal[1], m.unit));
  });

  return lines.join("\n");
}

function downloadCSV(csv, filename) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── component ────────────────────────────────────────────────────────────────
/**
 * <ExportButton nodeData={nodeData} reservoirData={reservoirData} />
 *
 * Exports a full CSV with node readings, AFLC decisions, reservoir status,
 * and optimal-range reference — all matching what's visible on the dashboard.
 *
 * Optional props:
 *   className  – extra CSS classes (defaults to "btn ghost" to match the header)
 *   label      – button text
 *   onExported – called after a successful export (e.g. to show a toast)
 */
export default function ExportButton({
  nodeData,
  reservoirData,
  className  = "btn ghost",
  label      = "Export data",
  onExported = null,
}) {
  const [loading, setLoading] = useState(false);

  function handleExport() {
    if (!nodeData || !reservoirData) return;
    setLoading(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const csv  = buildCSV(nodeData, reservoirData);
      downloadCSV(csv, `VertiFarmVision_${date}.csv`);
      onExported?.();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className={className}
      onClick={handleExport}
      disabled={loading || !nodeData || !reservoirData}
      title="Export all sensor data to a spreadsheet (.csv)"
    >
      <Icon name={loading ? "loader" : "download"} size={16} />
      <span className="btn-label">{loading ? "Exporting…" : label}</span>
    </button>
  );
}
