import { NODES } from "../../config/thresholds";

/** One series per node for a given metric, ready for <TrendChart series={…} />. */
export const nodeSeries = (metric) =>
  NODES.map((n) => ({
    key: n.key,
    label: n.name,
    color: n.color,
    marker: n.marker,
    get: (p) => p[n.key]?.[metric],
  }));

/** Average of both nodes at each history point — feeds the KPI sparklines. */
export const averageValues = (points, metric) =>
  points.map((p) => {
    const vals = NODES.map((n) => p[n.key]?.[metric]).filter(Number.isFinite);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
  });
