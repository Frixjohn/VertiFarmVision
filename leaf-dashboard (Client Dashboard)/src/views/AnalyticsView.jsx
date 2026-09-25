import React, { useState } from "react";
import { HealthSummary, StatCard, MetricCard, AflcCard, ReservoirPanel, PlantHealthCard } from "../components/dashboard";
import { SectionHeader, Segmented } from "../components/ui";
import { averageValues } from "../components/charts/series";
import { ENV_METRICS, HISTORY_RANGES, NODES } from "../config/thresholds";

export default function AnalyticsView({
  nodes, averages, nodeHistory, reservoirHistory, aflc, reservoir, issues,
  connection, lastUpdated, now, latestMLResult,
  onRunMotor, motorBusy, onCapture, cameraBusy,
  onUploadImage, uploadBusy,
}) {
  const [rangeKey, setRangeKey] = useState("15m");
  const rangeMs = HISTORY_RANGES.find((r) => r.key === rangeKey).ms;

  return (
    <div className="stack">
      <HealthSummary issues={issues} connection={connection} lastUpdated={lastUpdated} now={now} />

      <section className="stats-row" aria-label="Farm-wide averages">
        {ENV_METRICS.map((m) => (
          <StatCard key={m} metric={m} value={averages[m]} history={averageValues(nodeHistory, m)} />
        ))}
      </section>

      <section>
        <SectionHeader title="AFLC decisions" subtitle="Adaptive fuzzy logic controller: irrigation advice per node" />
        <div className="grid-2">
          {NODES.map((n) => (
            <AflcCard key={n.key} node={n} data={nodes[n.key]} decision={aflc[n.key]} />
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Environment by node" subtitle="Shaded band = optimal range. Hover or use ← → on a chart to inspect readings.">
          <Segmented label="Trend window" options={HISTORY_RANGES} value={rangeKey} onChange={setRangeKey} />
        </SectionHeader>
        <div className="grid-2">
          {ENV_METRICS.map((m) => (
            <MetricCard key={m} metric={m} nodes={nodes} points={nodeHistory} rangeMs={rangeMs} />
          ))}
        </div>
      </section>

      <ReservoirPanel
        reservoir={reservoir}
        points={reservoirHistory}
        onRunMotor={onRunMotor}
        motorBusy={motorBusy}
        onCapture={onCapture}
        cameraBusy={cameraBusy}
        onUploadImage={onUploadImage}
        uploadBusy={uploadBusy}
      />

      {latestMLResult && <PlantHealthCard result={latestMLResult} />}
    </div>
  );
}
