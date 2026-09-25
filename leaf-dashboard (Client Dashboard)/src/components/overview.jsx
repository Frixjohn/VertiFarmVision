import React, { useRef, useState } from "react";
import Icon from "./Icon";
import { Segmented, StatusIcon, StatusPill } from "./ui";
import TrendChart from "./charts/TrendChart";
import Sparkline from "./charts/Sparkline";
import { nodeSeries } from "./charts/series";
import { useAnimatedNumber } from "../hooks/useDashboardHooks";
import { ENV_METRICS, HISTORY_RANGES, METRICS, NODES, formatValue, getStatus, rangeLabel } from "../config/thresholds";

// Compact building blocks for the one-screen Overview.
// (The roomier versions of each live in components/dashboard.jsx and power the Analytics tab.)

/** KPI tile: metric, farm-wide average, status, sparkline. */
export function StatTile({ metric, value, history }) {
  const meta = METRICS[metric];
  const animated = useAnimatedNumber(value);
  const status = getStatus(metric, value);

  return (
    <article className="stat-tile" aria-label={`Average ${meta.label}: ${formatValue(metric, value)}, ${status.label}`}>
      <header>
        <span className="icon-badge sm"><Icon name={meta.icon} size={15} /></span>
        <span className="stat-label" title="Average of both nodes">{meta.short} <span className="muted">avg</span></span>
        <StatusPill status={status} />
      </header>
      <div className="tile-main">
        <div className="stat-value">
          {formatValue(metric, animated, { unit: false })}
          <span className="stat-unit">{meta.unit}</span>
        </div>
        <Sparkline values={history} height={34} tone={status.tone === "success" ? "brand" : status.tone} />
      </div>
    </article>
  );
}

/** One metric at a time, both nodes, with the optimal range shaded. Fills its card. */
export function TrendPanel({ nodes, points }) {
  const [metric, setMetric] = useState("temperature");
  const [rangeKey, setRangeKey] = useState("15m");
  const meta = METRICS[metric];
  const rangeMs = HISTORY_RANGES.find((r) => r.key === rangeKey).ms;

  return (
    <section className="card ov-trend" aria-label="Environment trend">
      <header className="trend-head">
        <div>
          <h3>Environment trend</h3>
          <p className="muted">{meta.label} · optimal {rangeLabel(metric)}</p>
        </div>
        <Segmented label="Trend window" options={HISTORY_RANGES} value={rangeKey} onChange={setRangeKey} />
      </header>

      <Segmented
        className="wide"
        label="Metric"
        value={metric}
        onChange={setMetric}
        options={ENV_METRICS.map((m) => ({ key: m, label: METRICS[m].short, icon: METRICS[m].icon }))}
      />

      <div className="trend-now">
        {NODES.map((n) => {
          const v = nodes[n.key]?.[metric];
          return (
            <div className="now-item compact" key={n.key}>
              <div className="now-top">
                <span className="node-chip"><i className={`shape ${n.marker}`} style={{ background: n.color }} />{n.name}</span>
                <StatusPill status={getStatus(metric, v)} />
              </div>
              <div className="now-value">{formatValue(metric, v)}</div>
            </div>
          );
        })}
      </div>

      <TrendChart fill metric={metric} points={points} series={nodeSeries(metric)} rangeMs={rangeMs} />
    </section>
  );
}

const DECISION_ICON = { IRRIGATE: "droplet", MONITOR: "eye", OPTIMAL: "checkCircle" };

export function AflcMini({ node, decision }) {
  const key = decision.decision.toLowerCase();
  return (
    <article className="card aflc-mini">
      <header>
        <span className="node-chip"><i className={`shape ${node.marker}`} style={{ background: node.color }} />{node.name}</span>
        <span className="muted tiny">{node.layer}</span>
        <span className={`aflc-badge ${key}`}>
          <Icon name={DECISION_ICON[decision.decision]} size={13} strokeWidth={2.4} />
          {decision.decision}
        </span>
      </header>

      <div className="confidence-row">
        <span>Confidence</span>
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={decision.confidence} aria-label={`${node.name} decision confidence`}>
          <div className={`meter-fill ${key}`} style={{ width: `${decision.confidence}%` }} />
        </div>
        <strong>{decision.confidence}%</strong>
      </div>

      <p className="aflc-reason small" title={decision.reason}>
        <Icon name="bulb" size={15} />
        <span className="clamp-1">{decision.reason}</span>
      </p>
    </article>
  );
}

export function ReservoirMini({ reservoir, onRunMotor, motorBusy, onCapture, cameraBusy, onUploadImage, uploadBusy }) {
  const low = reservoir.waterLevelTriggered;
  const fileRef = useRef(null);
  const rows = [
    ["ph", reservoir.waterPH],
    ["tds", reservoir.tds],
    ["turbidity", reservoir.turbidity],
  ];

  return (
    <section className="card res-mini" aria-label="Reservoir">
      <header className="card-head">
        <span className="icon-badge sm"><Icon name="flask" size={15} /></span>
        <h3>Reservoir</h3>
        {low && <span className="pill tone-danger pulse"><Icon name="alert" size={12} />Low water</span>}
      </header>

      <ul className="res-rows">
        {rows.map(([m, v]) => (
          <li key={m}>
            <span className="res-label"><Icon name={METRICS[m].icon} size={15} />{METRICS[m].label}</span>
            <strong>{formatValue(m, v)}</strong>
            <StatusIcon status={getStatus(m, v)} />
          </li>
        ))}
        <li className={low ? "bad" : ""}>
          <span className="res-label"><Icon name="droplet" size={15} />Water level</span>
          <strong>{low ? "Low" : "OK"}</strong>
          <StatusIcon status={low ? { state: "high", label: "Low, refill now", tone: "danger" } : { state: "ok", label: "Sufficient", tone: "success" }} />
        </li>
        <li>
          <span className="res-label"><Icon name="power" size={15} />Motor</span>
          <strong>{reservoir.motorState}</strong>
          <StatusIcon status={{ state: reservoir.motorRunning ? "ok" : "unknown", label: reservoir.motorRunning ? "Running" : "Idle", tone: reservoir.motorRunning ? "success" : "muted" }} />
        </li>
      </ul>

      <div className="res-btns">
        <button className="btn primary sm" onClick={onRunMotor} disabled={motorBusy || reservoir.motorRunning}>
          <Icon name={motorBusy || reservoir.motorRunning ? "loader" : "play"} size={14} />
          {motorBusy || reservoir.motorRunning ? "Running…" : "Run motor"}
        </button>
        <button className="btn ghost sm" onClick={onCapture} disabled={cameraBusy}>
          <Icon name={cameraBusy ? "loader" : "camera"} size={14} />
          {cameraBusy ? "Capturing…" : "Capture"}
        </button>
        {onUploadImage && (
          <>
            <button className="btn ghost sm" onClick={() => fileRef.current?.click()} disabled={uploadBusy} title="Upload a test image for the ML model">
              <Icon name={uploadBusy ? "loader" : "arrowUp"} size={14} />
              {uploadBusy ? "Analysing…" : "Upload test image"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => { onUploadImage(e.target.files?.[0]); e.target.value = ""; }} />
          </>
        )}
      </div>
    </section>
  );
}
