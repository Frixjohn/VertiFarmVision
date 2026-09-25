import React from "react";
import { HealthSummary } from "../components/dashboard";
import { AflcMini, ReservoirMini, StatTile, TrendPanel } from "../components/overview";
import { averageValues } from "../components/charts/series";
import { ENV_METRICS, NODES } from "../config/thresholds";

/**
 * The at-a-glance page. Everything a grower needs in one screen, no scrolling
 * on a normal desktop display. Detail lives in the Analytics / Sensors / Nodes tabs.
 */
export default function OverviewView({
  nodes, averages, nodeHistory, aflc, reservoir, issues,
  connection, lastUpdated, now,
  onRunMotor, motorBusy, onCapture, cameraBusy,
  onUploadImage, uploadBusy,
}) {
  return (
    <div className="overview">
      <HealthSummary compact issues={issues} connection={connection} lastUpdated={lastUpdated} now={now} />

      <section className="stats-row tiles" aria-label="Farm-wide averages">
        {ENV_METRICS.map((m) => (
          <StatTile key={m} metric={m} value={averages[m]} history={averageValues(nodeHistory, m)} />
        ))}
      </section>

      <div className="ov-grid">
        <TrendPanel nodes={nodes} points={nodeHistory} />

        <div className="ov-aflc">
          {NODES.map((n) => <AflcMini key={n.key} node={n} decision={aflc[n.key]} />)}
        </div>

        <ReservoirMini
          reservoir={reservoir}
          onRunMotor={onRunMotor} motorBusy={motorBusy}
          onCapture={onCapture} cameraBusy={cameraBusy}
          onUploadImage={onUploadImage} uploadBusy={uploadBusy}
        />
      </div>
    </div>
  );
}
