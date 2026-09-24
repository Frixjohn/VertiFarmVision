import { ENV_METRICS, NODES, getStatus } from "./thresholds";

/**
 * Flat list of everything currently outside its optimal range, plus the
 * float-switch alarm. Drives the health summary on the Overview page.
 */
export function computeIssues(nodes, reservoir) {
  const issues = [];

  if (reservoir.waterLevelTriggered) {
    issues.push({ id: "water-level", where: "Reservoir", label: "Water level low", critical: true });
  }

  NODES.forEach((n) =>
    ENV_METRICS.forEach((metric) => {
      const value = nodes[n.key]?.[metric];
      const status = getStatus(metric, value);
      if (status.state === "low" || status.state === "high") {
        issues.push({ id: `${n.key}-${metric}`, where: n.name, metric, value, status });
      }
    })
  );

  [
    ["ph", reservoir.waterPH],
    ["tds", reservoir.tds],
    ["turbidity", reservoir.turbidity],
  ].forEach(([metric, value]) => {
    const status = getStatus(metric, value);
    if (status.state === "low" || status.state === "high") {
      issues.push({ id: `res-${metric}`, where: "Reservoir", metric, value, status });
    }
  });

  return issues;
}
