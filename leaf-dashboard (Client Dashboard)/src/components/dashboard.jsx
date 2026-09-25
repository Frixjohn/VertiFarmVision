import React, { useRef } from "react";
import Icon from "./Icon";
import { StatusPill } from "./ui";
import TrendChart from "./charts/TrendChart";
import Sparkline from "./charts/Sparkline";
import RangeGauge from "./charts/RangeGauge";
import { nodeSeries } from "./charts/series";
import { useAnimatedNumber, timeAgo } from "../hooks/useDashboardHooks";
import { METRICS, NODES, formatValue, getStatus, rangeLabel } from "../config/thresholds";

// ── Health summary ────────────────────────────────────────────────────────────
export function HealthSummary({ issues, connection, lastUpdated, now, compact = false }) {
  const critical = issues.some((i) => i.critical);
  const offline = connection === "offline";
  const tone = offline || critical ? "danger" : issues.length ? "warning" : "success";
  const icon = offline || critical ? "alert" : issues.length ? "alert" : "checkCircle";

  let title;
  let detail;
  if (offline) {
    title = "No live data";
    detail = "The server can't be reached, so the values below are placeholders, not real readings.";
  } else if (connection === "connecting") {
    title = "Connecting to the farm…";
    detail = "Waiting for the first readings.";
  } else if (critical) {
    title = "Action needed: reservoir water level is low";
    detail = "Refill the reservoir to protect the pump and keep nutrient levels stable.";
  } else if (issues.length) {
    title = `${issues.length} reading${issues.length > 1 ? "s" : ""} outside the optimal range`;
    detail = "Check the highlighted sensors below.";
  } else {
    title = "All readings are within their optimal range";
    detail = `${NODES.length === 1 ? "The node" : "All nodes"} and the reservoir look healthy. Last reading ${timeAgo(lastUpdated, now)}.`;
  }

  const shown = issues.filter((i) => !i.critical).slice(0, 4);
  const more = issues.filter((i) => !i.critical).length - shown.length;

  return (
    <section className={`health health-${tone} ${compact ? "health-compact" : ""}`} aria-label="System health">
      <span className="health-icon"><Icon name={icon} size={22} /></span>
      <div className="health-body">
        <h3>{title}</h3>
        {(!compact || offline || connection !== "connected") && <p>{detail}</p>}
        {!offline && shown.length > 0 && (
          <ul className="health-chips">
            {shown.map((i) => (
              <li key={i.id}>
                <strong>{i.where}</strong> · {METRICS[i.metric].short}{" "}
                <span className="tone-warning">{i.status.label} ({formatValue(i.metric, i.value)})</span>
              </li>
            ))}
            {more > 0 && <li>+{more} more</li>}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── KPI stat card ─────────────────────────────────────────────────────────────
export function StatCard({ metric, value, history }) {
  const meta = METRICS[metric];
  const animated = useAnimatedNumber(value);
  const status = getStatus(metric, value);

  return (
    <article className="stat-card" aria-label={`Average ${meta.label}: ${formatValue(metric, value)}, ${status.label}`}>
      <header>
        <span className="icon-badge"><Icon name={meta.icon} size={16} /></span>
        <span className="stat-label">Avg {meta.short}</span>
      </header>
      <div className="stat-value">
        {formatValue(metric, animated, { unit: false })}
        <span className="stat-unit">{meta.unit}</span>
      </div>
      <Sparkline values={history} tone={status.tone === "success" ? "brand" : status.tone} />
      <footer>
        <StatusPill status={status} />
        <span>Target {rangeLabel(metric)}</span>
      </footer>
    </article>
  );
}

// ── Per-metric chart card: current values per node + trend ───────────────────
export function MetricCard({ metric, nodes, points, rangeMs }) {
  const meta = METRICS[metric];
  return (
    <article className="card metric-card">
      <header className="card-head">
        <span className="icon-badge"><Icon name={meta.icon} size={16} /></span>
        <div>
          <h3>{meta.label}</h3>
          <p className="muted">{meta.source} · optimal {rangeLabel(metric)}</p>
        </div>
      </header>

      <div className="metric-now">
        {NODES.map((n) => {
          const v = nodes[n.key]?.[metric];
          const status = getStatus(metric, v);
          return (
            <div className="now-item" key={n.key}>
              <div className="now-top">
                <span className="node-chip"><i className={`shape ${n.marker}`} style={{ background: n.color }} />{n.name}</span>
                <StatusPill status={status} />
              </div>
              <div className="now-value">{formatValue(metric, v)}</div>
              <RangeGauge metric={metric} value={v} />
            </div>
          );
        })}
      </div>

      <TrendChart metric={metric} points={points} series={nodeSeries(metric)} rangeMs={rangeMs} />
    </article>
  );
}

// ── AFLC decision card ────────────────────────────────────────────────────────
const DECISION_ICON = { IRRIGATE: "droplet", MONITOR: "eye", OPTIMAL: "checkCircle" };

export function AflcCard({ node, data, decision }) {
  const key = decision.decision.toLowerCase();
  return (
    <article className="card aflc-card">
      <header className="aflc-head">
        <div>
          <h4>{node.name} decision</h4>
          <p className="muted">{node.layer}</p>
        </div>
        <span className={`aflc-badge ${key}`}>
          <Icon name={DECISION_ICON[decision.decision]} size={14} strokeWidth={2.4} />
          {decision.decision}
        </span>
      </header>

      <div className="confidence">
        <div className="confidence-top">
          <span>Confidence</span>
          <strong>{decision.confidence}%</strong>
        </div>
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={decision.confidence} aria-label="Decision confidence">
          <div className={`meter-fill ${key}`} style={{ width: `${decision.confidence}%` }} />
        </div>
      </div>

      <p className="aflc-reason"><Icon name="bulb" size={16} />{decision.reason}</p>

      <ul className="factor-list" aria-label="Inputs used for this decision">
        {["temperature", "humidity", "co2"].map((m) => {
          const status = getStatus(m, data[m]);
          return (
            <li key={m}>
              <span className="factor-name"><Icon name={METRICS[m].icon} size={14} />{METRICS[m].short}</span>
              <strong>{formatValue(m, data[m])}</strong>
              <StatusPill status={status} />
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// ── Reservoir panel ───────────────────────────────────────────────────────────
function ResTile({ metric, value, points }) {
  const meta = METRICS[metric];
  const status = getStatus(metric, value);
  const history = points.map((p) => p[metric]);
  return (
    <div className="res-tile">
      <div className="res-tile-top">
        <span className="res-label"><Icon name={meta.icon} size={15} />{meta.label}</span>
        <StatusPill status={status} />
      </div>
      <div className="res-value">{formatValue(metric, value)}</div>
      <RangeGauge metric={metric} value={value} />
      <Sparkline values={history} height={24} tone={status.tone === "success" ? "brand" : status.tone} />
    </div>
  );
}

export function ReservoirPanel({
  reservoir, points, onRunMotor, motorBusy, onCapture, cameraBusy,
  onUploadImage, uploadBusy,
}) {
  const fileRef = useRef(null);
  const low = reservoir.waterLevelTriggered;
  return (
    <section className="card reservoir">
      <header className="card-head">
        <span className="icon-badge"><Icon name="flask" size={16} /></span>
        <div>
          <h3>Reservoir</h3>
          <p className="muted">Shared by all nodes</p>
        </div>
        {low && <span className="pill tone-danger pulse"><Icon name="alert" size={12} />Low water</span>}
      </header>

      <div className="res-grid">
        <ResTile metric="ph" value={reservoir.waterPH} points={points} />
        <ResTile metric="tds" value={reservoir.tds} points={points} />
        <ResTile metric="turbidity" value={reservoir.turbidity} points={points} />

        <div className={`res-tile ${low ? "res-danger" : ""}`}>
          <div className="res-tile-top">
            <span className="res-label"><Icon name="droplet" size={15} />Water level</span>
            <span className={`pill ${low ? "tone-danger" : "tone-success"}`}>
              <Icon name={low ? "alert" : "check"} size={12} strokeWidth={2.6} />{low ? "Low" : "OK"}
            </span>
          </div>
          <div className="res-value">{low ? "Refill now" : "Sufficient"}</div>
          <p className="muted res-note">Float switch sensor</p>
        </div>

        <div className="res-tile">
          <div className="res-tile-top">
            <span className="res-label"><Icon name="power" size={15} />Stepper motor</span>
            <span className={`pill ${reservoir.motorRunning ? "tone-success" : "tone-muted"}`}>
              {reservoir.motorRunning ? "Running" : "Idle"}
            </span>
          </div>
          <div className="res-value">{reservoir.motorState}</div>
          <p className="muted res-note">10 s run / 30 s stop cycle</p>
        </div>

        <div className="res-tile res-actions">
          <button className="btn primary" onClick={onRunMotor} disabled={motorBusy || reservoir.motorRunning}>
            <Icon name={motorBusy || reservoir.motorRunning ? "loader" : "play"} size={16} />
            {motorBusy ? "Command sent…" : reservoir.motorRunning ? "Motor running…" : "Run motor (15 s)"}
          </button>
          <button className="btn ghost" onClick={onCapture} disabled={cameraBusy}>
            <Icon name={cameraBusy ? "loader" : "camera"} size={16} />
            {cameraBusy ? "Capturing…" : "Capture image"}
          </button>

          {/* TEMPORARY: manual image upload for testing the ML model without an ESP32-CAM */}
          <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={uploadBusy}>
            <Icon name={uploadBusy ? "loader" : "arrowUp"} size={16} />
            {uploadBusy ? "Analysing…" : "Upload test image"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => { onUploadImage?.(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>
      </div>
    </section>
  );
}

// ── AI plant-health card ──────────────────────────────────────────────────────
export function PlantHealthCard({ result }) {
  const healthy = result.label === "healthy";
  const probs = result.probabilities ?? {};
  const pHealthy = probs.healthy ?? 0;
  const pDiseased = probs.diseased ?? 0;

  return (
    <section className={`card plant ${healthy ? "plant-ok" : "plant-bad"}`}>
      <header className="card-head">
        <span className="icon-badge"><Icon name="bot" size={16} /></span>
        <div>
          <h3>AI plant health</h3>
          <p className="muted">
            Last analysed {result.timestamp ? new Date(result.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"} · MobileNetV3
          </p>
        </div>
        <span className={`pill big ${healthy ? "tone-success" : "tone-danger pulse"}`}>
          <Icon name={healthy ? "leaf" : "alert"} size={14} />{healthy ? "Healthy" : "Diseased"}
        </span>
      </header>

      <div className={`plant-body ${result.imageData ? "with-img" : ""}`}>
        {result.imageData && (
          <img src={result.imageData} alt="Last analysed plant" onClick={() => window.open(result.imageData, "_blank")} title="Open full size" />
        )}
        <div className="plant-probs">
          <div className="stack-bar" role="img" aria-label={`Healthy ${pHealthy.toFixed(1)} percent, diseased ${pDiseased.toFixed(1)} percent`}>
            <div className="stack-ok" style={{ width: `${pHealthy}%` }} />
            <div className="stack-bad" style={{ width: `${pDiseased}%` }} />
          </div>
          <div className="prob-row"><span><i className="dot ok" />Healthy</span><strong>{pHealthy.toFixed(1)}%</strong></div>
          <div className="prob-row"><span><i className="dot bad" />Diseased</span><strong>{pDiseased.toFixed(1)}%</strong></div>
        </div>
      </div>
    </section>
  );
}
