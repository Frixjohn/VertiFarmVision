import React from "react";
import Icon from "../components/Icon";
import { StatusPill } from "../components/ui";
import { ENV_METRICS, METRICS, NODES, formatValue, getStatus } from "../config/thresholds";

const DECISION_ICON = { IRRIGATE: "droplet", MONITOR: "eye", OPTIMAL: "checkCircle" };

function AflcStatus({ decision }) {
  if (!decision) return null;
  const key = decision.decision.toLowerCase();
  const hasDetail = decision.ecl || decision.chs || decision.demandPct != null;
  return (
    <div className="aflc-status">
      <div className="aflc-status-top">
        <span className="aflc-status-label"><Icon name="bot" size={14} />AFLC status</span>
        <span className={`aflc-badge ${key}`}>
          <Icon name={DECISION_ICON[decision.decision] ?? "info"} size={14} strokeWidth={2.4} />
          {decision.decision}
        </span>
      </div>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={decision.confidence} aria-label="AFLC confidence">
        <div className={`meter-fill ${key}`} style={{ width: `${decision.confidence}%` }} />
      </div>
      <p className="aflc-status-reason">{decision.confidence}% confidence · {decision.reason}</p>
      {hasDetail && (
        <ul className="aflc-status-detail">
          {decision.ecl && <li><span className="muted">Environmental condition</span><strong>{decision.ecl}</strong></li>}
          {decision.chs && <li><span className="muted">Crop health</span><strong>{decision.chs}</strong></li>}
          {decision.demandPct != null && <li><span className="muted">Water demand</span><strong>{decision.demandPct}%</strong></li>}
          {decision.holdDelaySec != null && <li><span className="muted">Hold delay</span><strong>{decision.holdDelaySec}s</strong></li>}
          {decision.pumpDurationSec != null && decision.pumpDurationSec > 0 && (
            <li><span className="muted">Pump duration</span><strong>{decision.pumpDurationSec}s</strong></li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function NodesView({ nodes, aflc, irrigateAllStatus, onIrrigateAll }) {
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
          {aflc && (
            <div className="irrigate-aflc">
              {NODES.map((n) => aflc[n.key] && (
                <span key={n.key} className="irrigate-aflc-chip">
                  AFLC · {n.name}: <strong>{aflc[n.key].decision}</strong>
                </span>
              ))}
            </div>
          )}
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

              <AflcStatus decision={aflc?.[n.key]} />

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
