import React from "react";
import Icon from "../components/Icon";
import { SectionHeader, StatusPill } from "../components/ui";
import Sparkline from "../components/charts/Sparkline";
import RangeGauge from "../components/charts/RangeGauge";
import { ENV_METRICS, METRICS, NODES, formatValue, getStatus, rangeLabel } from "../config/thresholds";

// Manual-override limits for the edit dialog (unchanged from the original app).
const EDIT_LIMITS = {
  temperature: { min: 15, max: 35, step: 0.1 },
  humidity:    { min: 40, max: 90, step: 1 },
  co2:         { min: 300, max: 3000, step: 10 },
};

function SensorCard({ metric, value, history, sub, onEdit }) {
  const meta = METRICS[metric];
  const status = getStatus(metric, value);
  return (
    <article className={`sensor-card state-${status.state}`}>
      <header>
        <span className="sensor-name"><Icon name={meta.icon} size={15} />{meta.label}</span>
        {onEdit && (
          <button className="icon-btn small" onClick={onEdit} aria-label={`Edit ${meta.label}`} title="Edit value">
            <Icon name="pencil" size={14} />
          </button>
        )}
      </header>
      <div className="sensor-value">{formatValue(metric, value)}</div>
      <StatusPill status={status}>{status.label === "Optimal" ? `Optimal · ${rangeLabel(metric)}` : status.label}</StatusPill>
      <RangeGauge metric={metric} value={value} />
      {history && <Sparkline values={history} height={26} tone={status.tone === "success" ? "brand" : status.tone} />}
      <p className="sensor-meta">{sub ?? meta.source}</p>
    </article>
  );
}

export default function SensorsView({ nodes, nodeHistory, reservoir, reservoirHistory, onEdit }) {
  const low = reservoir.waterLevelTriggered;
  return (
    <div className="stack">
      {NODES.map((n) => (
        <section key={n.key} className="card">
          <SectionHeader title={`${n.name} · ${n.layer}`} subtitle="Environmental sensors on this rack layer">
            <span className="node-chip"><i className={`shape ${n.marker}`} style={{ background: n.color }} />{n.name}</span>
          </SectionHeader>
          <div className="sensor-grid">
            {ENV_METRICS.map((m) => (
              <SensorCard
                key={m}
                metric={m}
                value={nodes[n.key]?.[m]}
                history={nodeHistory.map((p) => p[n.key]?.[m])}
                onEdit={EDIT_LIMITS[m] ? () => onEdit({
                  node: n.key, key: m, name: `${METRICS[m].label} (${n.name})`,
                  value: nodes[n.key][m], unit: METRICS[m].sep + METRICS[m].unit, ...EDIT_LIMITS[m],
                }) : undefined}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="card">
        <SectionHeader title="Reservoir" subtitle="Universal sensors shared by every node">
          {low && <span className="pill tone-danger pulse"><Icon name="alert" size={12} />Water level low</span>}
        </SectionHeader>
        <div className="sensor-grid">
          {["ph", "tds", "turbidity"].map((m) => (
            <SensorCard
              key={m}
              metric={m}
              value={{ ph: reservoir.waterPH, tds: reservoir.tds, turbidity: reservoir.turbidity }[m]}
              history={reservoirHistory.map((p) => p[m])}
            />
          ))}
        </div>

        <div className="reservoir-status-grid">
          <article className={`sensor-card ${low ? "state-danger" : "state-ok"}`}>
            <header><span className="sensor-name"><Icon name="droplet" size={15} />Water level</span></header>
            <div className="sensor-value">{low ? "Low" : "Sufficient"}</div>
            <span className={`pill ${low ? "tone-danger" : "tone-success"}`}>
              <Icon name={low ? "alert" : "check"} size={12} strokeWidth={2.6} />
              {low ? "Refill reservoir now" : "No action needed"}
            </span>
            <p className="sensor-meta">Float switch sensor</p>
          </article>

          <article className="sensor-card">
            <header><span className="sensor-name"><Icon name="power" size={15} />Stepper motor</span></header>
            <div className="sensor-value">{reservoir.motorState}</div>
            <span className={`pill ${reservoir.motorRunning ? "tone-success" : "tone-muted"}`}>
              {reservoir.motorRunning ? "Pumping" : "Idle"}
            </span>
            <p className="sensor-meta">10 s run / 30 s stop cycle</p>
          </article>
        </div>
      </section>
    </div>
  );
}
