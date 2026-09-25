import React from "react";
import Icon from "../components/Icon";
import { SectionHeader, StatusPill } from "../components/ui";
import Sparkline from "../components/charts/Sparkline";
import RangeGauge from "../components/charts/RangeGauge";
import { ENV_METRICS, METRICS, NODES, formatValue, getStatus, rangeLabel } from "../config/thresholds";

const DECISION_ICON = { IRRIGATE: "droplet", MONITOR: "eye", OPTIMAL: "checkCircle" };

// Manual-override limits for the edit dialog (unchanged from the original Sensors tab).
const EDIT_LIMITS = {
  temperature: { min: 15, max: 35, step: 0.1 },
  humidity:    { min: 40, max: 90, step: 1 },
  co2:         { min: 300, max: 3000, step: 10 },
};

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

// Placeholder card for a node slot with no hardware wired up yet.
function WaitingNodeCard({ name, layer }) {
  return (
    <article className="card node-card waiting">
      <header className="card-head">
        <span className="icon-badge"><Icon name="radio" size={16} /></span>
        <div>
          <h3>{name}</h3>
          <p className="muted">{layer}</p>
        </div>
        <span className="pill tone-warning">Waiting</span>
      </header>
      <div className="waiting-state">
        <Icon name="hourglass" size={30} />
        <p>Waiting for hardware connection…</p>
        <p className="muted">This node appears automatically once it connects.</p>
      </div>
    </article>
  );
}

// One tower's worth of nodes: sensors, AFLC advice and irrigation status for each.
function TowerSection({ tower, nodes, nodeHistory, aflc, irrigateAllStatus, onEdit }) {
  return (
    <section className="tower-block">
      <SectionHeader title={tower.name} subtitle="Sensors, AFLC advice and irrigation status for this tower">
        <span className="pill tone-success"><i className="dot ok" />{tower.status}</span>
      </SectionHeader>

      <div className="stack">
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

              <div className="sensor-grid">
                {ENV_METRICS.map((m) => (
                  <SensorCard
                    key={m}
                    metric={m}
                    value={d[m]}
                    history={nodeHistory.map((p) => p[n.key]?.[m])}
                    onEdit={EDIT_LIMITS[m] ? () => onEdit({
                      node: n.key, key: m, name: `${METRICS[m].label} (${n.name})`,
                      value: d[m], unit: METRICS[m].sep + METRICS[m].unit, ...EDIT_LIMITS[m],
                    }) : undefined}
                  />
                ))}
              </div>

              <div className="node-foot">
                <span className="muted"><Icon name="clock" size={14} /> Last irrigation: <strong>{d.lastIrrigation ?? "—"}</strong></span>
                <span className={`pill ${active ? "tone-info pulse" : "tone-muted"}`}>
                  <Icon name={active ? "droplet" : "check"} size={12} />{active ? "Irrigating" : "Idle"}
                </span>
              </div>
            </article>
          );
        })}

        <WaitingNodeCard name="Node 2" layer="Layer 2" />
      </div>
    </section>
  );
}

export default function TowersView({
  nodes, nodeHistory, reservoir, reservoirHistory, aflc,
  irrigateAllStatus, onIrrigateAll, onEdit,
}) {
  const irrigating = irrigateAllStatus === "active";
  const low = reservoir.waterLevelTriggered;

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

      <TowerSection
        tower={{ name: "Tower 1", status: "Active" }}
        nodes={nodes}
        nodeHistory={nodeHistory}
        aflc={aflc}
        irrigateAllStatus={irrigateAllStatus}
        onEdit={onEdit}
      />

      <section className="card">
        <SectionHeader title="Reservoir" subtitle="Universal sensors shared by every node in this tower">
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

      <section className="card tower-waiting">
        <div className="waiting-state">
          <Icon name="hourglass" size={34} />
          <h3>Tower 2</h3>
          <p>Waiting for next tower…</p>
          <p className="muted">A new tower appears here automatically once it connects.</p>
        </div>
      </section>
    </div>
  );
}
