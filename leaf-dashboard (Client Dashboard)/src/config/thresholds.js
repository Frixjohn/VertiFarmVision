// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for every "optimal range" the dashboard shows.
// Charts, gauges, status pills, the health summary and the CSV export all read
// from here, so a range is only ever edited in one place.
// ─────────────────────────────────────────────────────────────────────────────

export const METRICS = {
  temperature: { label: "Temperature", short: "Temp",     unit: "°C",  sep: "",  decimals: 1, optimal: [22, 26],     scale: [15, 35],      icon: "thermometer", source: "Air temperature" },
  humidity:    { label: "Humidity",    short: "Humidity", unit: "%",   sep: "",  decimals: 0, optimal: [60, 75],     scale: [40, 90],      icon: "droplet",     source: "Relative humidity" },
  co2:         { label: "CO₂",         short: "CO₂",      unit: "ppm", sep: " ", decimals: 0, optimal: [400, 1200],  scale: [300, 2000],   icon: "wind",        source: "Sensirion SCD4x" },
  lux:         { label: "Light",       short: "Light",    unit: "lx",  sep: " ", decimals: 0, optimal: [5000, 80000], scale: [0, 100000],  icon: "sun",         source: "BH1750" },
  ph:          { label: "Water pH",    short: "pH",       unit: "",    sep: "",  decimals: 1, optimal: [5.5, 7.0],   scale: [4, 9],        icon: "flask",       source: "Atlas Scientific EZO-pH" },
  tds:         { label: "TDS",         short: "TDS",      unit: "ppm", sep: " ", decimals: 0, optimal: [500, 1500],  scale: [0, 2000],     icon: "zap",         source: "Total dissolved solids" },
  turbidity:   { label: "Turbidity",   short: "Turbidity", unit: "NTU", sep: " ", decimals: 0, optimal: [0, 50],     scale: [0, 100],      icon: "waves",       source: "Water clarity index", maxExclusive: true },
};

export const NODES = [
  { key: "node1", name: "Node 1", layer: "Layer 1", color: "var(--series-1)", marker: "circle" },
];

export const ENV_METRICS = ["temperature", "humidity", "co2", "lux"];

/** "24.5 °C", "820 ppm", "6.2" — one formatter so units are never inconsistent. */
export function formatValue(key, value, { unit = true } = {}) {
  const m = METRICS[key];
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const num = Number(value).toLocaleString(undefined, {
    minimumFractionDigits: m.decimals,
    maximumFractionDigits: m.decimals,
  });
  return unit && m.unit ? `${num}${m.sep}${m.unit}` : num;
}

/** "22–26 °C", "< 50 NTU" */
export function rangeLabel(key) {
  const m = METRICS[key];
  const [lo, hi] = m.optimal;
  const fmt = (v) => Number(v).toLocaleString();
  const u = m.unit ? `${m.sep}${m.unit}` : "";
  if (lo <= m.scale[0] && m.maxExclusive) return `< ${fmt(hi)}${u}`;
  return `${fmt(lo)}–${fmt(hi)}${u}`;
}

/**
 * state: ok | low | high | unknown
 * Status is always paired with a word + icon in the UI, never colour alone.
 */
export function getStatus(key, value) {
  const m = METRICS[key];
  if (value === null || value === undefined || Number.isNaN(value)) {
    return { state: "unknown", label: "No data", tone: "muted" };
  }
  const [lo, hi] = m.optimal;
  if (value < lo) return { state: "low", label: "Low", tone: "warning" };
  const over = m.maxExclusive ? value >= hi : value > hi;
  if (over) return { state: "high", label: "High", tone: "warning" };
  return { state: "ok", label: "Optimal", tone: "success" };
}

/** Position (0–100) of a value on a metric's display scale, clamped. */
export function scalePct(key, value) {
  const [min, max] = METRICS[key].scale;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

export const HISTORY_RANGES = [
  { key: "15m", label: "15 min", ms: 15 * 60 * 1000 },
  { key: "1h",  label: "1 hour", ms: 60 * 60 * 1000 },
  { key: "all", label: "All",    ms: Infinity },
];
