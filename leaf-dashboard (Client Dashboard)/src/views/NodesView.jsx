import React from "react";
import Icon from "../components/Icon";
import { StatusPill } from "../components/ui";
import { ENV_METRICS, METRICS, NODES, formatValue, getStatus } from "../config/thresholds";

export default function NodesView({ nodes, irrigateAllStatus, onIrrigateAll }) {
  const irrigating = irrigateAllStatus === "active";
  return (
    <div className="stack">
      <section className={`irrigate-banner ${irrigating ? "irrigating" : ""}`}>
        <span className="irrigate-icon"><Icon name={irrigating ? "loader" : "droplet"} size={26} /></span>
        <div className="irrigate-text">
          <h3>System irrigation</h3>
          <p>
            {irrigating
              ? "Irrigating all nodes. Pump signal sent to the ESP32."
              : "Triggers every active node and sends the pump signal to the ESP32 at the same time."}
          </p>
        </div>
        <button className="btn-irrigate-all" onClick={onIrrigateAll} disabled={irrigating}>
          <Icon name={irrigating ? "loader" : "droplet"} size={17} />
          {irrigating ? "Irrigating…" : "Irrigate entire system"}
        </button>
      </section>

      <div className="grid-3">
        {NODES.map((n) => {
          const d = nodes[n.key];
          const active = irrigateAllStatus === "active" || d.irrigationStatus === "active";
          return (
            <article className="card node-card" key={n.key}>
              <header className="card-head">
                <span className="icon-badge"><Icon name="radio" size={16} /></span>
                <div>
                  <h3>{n.name}</h3>
                  <p className="muted">{n.layer}</p>
                </div>
                <span className="pill tone-success"><i className="dot ok" />Active</span>
              </header>

              <ul className="kv-list">
                {ENV_METRICS.map((m) => (
                  <li key={m}>
                    <span className="kv-label"><Icon name={METRICS[m].icon} size={14} />{METRICS[m].label}</span>
                    <strong>{formatValue(m, d[m])}</strong>
                    <StatusPill status={getStatus(m, d[m])} />
                  </li>
                ))}
              </ul>

              <div className="node-foot">
                <span className="muted"><Icon name="clock" size={14} /> Last irrigation: <strong>{d.lastIrrigation ?? "—"}</strong></span>
                <span className={`pill ${active ? "tone-info pulse" : "tone-muted"}`}>
                  <Icon name={active ? "droplet" : "check"} size={12} />{active ? "Irrigating" : "Idle"}
                </span>
              </div>
            </article>
          );
        })}

        <article className="card node-card waiting">
          <header className="card-head">
            <span className="icon-badge"><Icon name="radio" size={16} /></span>
            <div>
              <h3>Node 3</h3>
              <p className="muted">Layer 3</p>
            </div>
            <span className="pill tone-warning">Waiting</span>
          </header>
          <div className="waiting-state">
            <Icon name="hourglass" size={30} />
            <p>Waiting for hardware connection…</p>
            <p className="muted">This node appears automatically once it connects.</p>
          </div>
        </article>
      </div>
    </div>
  );
}
