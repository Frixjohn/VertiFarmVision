import React from "react";
import Icon from "./Icon";
import { useAflcStatus } from "../hooks/useAflcStatus";
import { timeAgo } from "../hooks/useDashboardHooks";

const DECISION_ICON = { IRRIGATE: "droplet", MONITOR: "eye", OPTIMAL: "checkCircle" };
const OUTCOME_ICON = { decided: "checkCircle", skipped: "hourglass", failed: "alert" };

function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Works out which of four states the controller is in, from the heartbeat payload. */
function deriveState({ status, offline, serverNow }) {
  if (!status) return offline ? "offline" : "connecting";
  if (offline) return "offline";
  if (status.running) return "thinking";
  const overdue = status.nextRunAt && serverNow - status.nextRunAt > 60_000;
  if (overdue) return "stalled";
  return "alive";
}

const STATE_COPY = {
  connecting: { label: "Connecting…", sub: "Asking the server for AFLC status" },
  offline:    { label: "Can't reach server", sub: "The dashboard can't get an AFLC heartbeat" },
  thinking:   { label: "Thinking…", sub: "Reading sensors and running the fuzzy rules" },
  stalled:    { label: "Overdue", sub: "The next AFLC run should have happened already" },
  alive:      { label: "Alive", sub: "Idle between decisions" },
};

/** ECG-style trace. Animation + colour come from the state class on the card. */
function Trace() {
  return (
    <svg className="hb-trace" viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="hb-trace-flat" d="M0 20 H240" />
      <path
        className="hb-trace-beat"
        d="M0 20 H40 L48 20 L54 6 L62 34 L68 20 H110 L116 20 L122 6 L130 34 L136 20 H178 L184 20 L190 6 L198 34 L204 20 H240"
      />
    </svg>
  );
}

function DecisionBadge({ decision }) {
  return (
    <span className={`aflc-badge ${decision.toLowerCase()}`}>
      <Icon name={DECISION_ICON[decision] ?? "info"} size={14} strokeWidth={2.4} />
      {decision}
    </span>
  );
}

export default function AflcHeartbeat({ now }) {
  const { status, offline, offset, runNow, runBusy, runError } = useAflcStatus();

  const serverNow = now + offset; // "now" on the server's clock
  const state = deriveState({ status, offline, serverNow });
  const copy = STATE_COPY[state];

  const interval = status?.intervalMs ?? 0;
  const remaining = status?.nextRunAt ? status.nextRunAt - serverNow : null;
  const progress = interval && remaining !== null
    ? Math.min(1, Math.max(0, 1 - remaining / interval))
    : 0;

  const latest = status?.recent?.[0];
  const lastRanAgo = status?.lastFinishedAt ? timeAgo(status.lastFinishedAt - offset, now) : "not yet";

  return (
    <section className={`card hb hb--${state}`} aria-label="AFLC heartbeat" aria-live="polite">
      {/* ── Top: pulse + state + countdown ── */}
      <header className="hb-top">
        <div className="hb-id">
          <span className="hb-dot" aria-hidden="true" />
          <div>
            <h4>
              AFLC heartbeat <span className="hb-state">· {copy.label}</span>
              {state === "thinking" && <span className="hb-ellipsis" aria-hidden="true"><i /><i /><i /></span>}
            </h4>
            <p className="muted hb-sub">{copy.sub}</p>
          </div>
        </div>

        <div className="hb-actions">
          <div className="hb-next">
            <span className="tiny">Next decision in</span>
            <strong className="hb-clock">
              {state === "thinking" ? "now"
                : remaining === null ? "—"
                : remaining <= 0 ? "due"
                : fmtCountdown(remaining)}
            </strong>
          </div>
          <button type="button" className="btn ghost sm" onClick={runNow} disabled={runBusy || offline || !status}>
            <Icon name={runBusy ? "loader" : "play"} size={14} />
            {runBusy ? "Running…" : "Run now"}
          </button>
        </div>
      </header>

      <Trace />

      <div className="hb-progress" role="progressbar" aria-label="Time until next AFLC decision"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className="hb-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <p className="tiny hb-meta">
        {status
          ? <>Last cycle finished {lastRanAgo} · {status.cycleCount} cycle{status.cycleCount === 1 ? "" : "s"} since server start · runs every {Math.round(interval / 60000)} min</>
          : "Waiting for the first heartbeat…"}
      </p>
      {runError && <p className="hb-error" role="alert"><Icon name="alert" size={14} />{runError}</p>}
      {status?.lastError && <p className="hb-error" role="alert"><Icon name="alert" size={14} />Scheduler error: {status.lastError}</p>}

      {/* ── What the last cycle did, per node ── */}
      {status?.nodes?.length > 0 && (
        <ul className="hb-cycle" aria-label="Last cycle result per node">
          {status.nodes.map((n) => (
            <li key={n.nodeId} className={`hb-cycle-${n.outcome}`}>
              <Icon name={OUTCOME_ICON[n.outcome] ?? "info"} size={14} />
              <strong>{n.nodeId}</strong>
              <span>{n.outcome === "decided" ? `decided → ${n.detail}` : `${n.outcome} — ${n.detail}`}</span>
              <span className="tiny hb-when">{timeAgo(n.at - offset, now)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Latest decision, with details ── */}
      <div className="hb-latest">
        {latest ? (
          <>
            <div className="hb-latest-head">
              <span className="tiny">Latest decision · {latest.node_label ?? "node"} · {timeAgo(new Date(latest.created_at).getTime() - offset, now)}</span>
              <DecisionBadge decision={latest.decision} />
            </div>

            <dl className="hb-facts">
              <div><dt>Confidence</dt><dd>{latest.confidence}%</dd></div>
              <div><dt>Stress level</dt><dd>{latest.ecl ?? "—"}</dd></div>
              <div><dt>Plant health</dt><dd>{latest.chs ?? "—"}</dd></div>
              <div><dt>Demand</dt><dd>{latest.demand_pct ?? "—"}{latest.demand_pct != null && "%"}</dd></div>
              <div><dt>Hold delay</dt><dd>{latest.hold_delay_sec ?? "—"}{latest.hold_delay_sec != null && "s"}</dd></div>
              <div><dt>Pump</dt><dd>{latest.pump_duration_sec ? `${latest.pump_duration_sec}s` : "no run"}</dd></div>
            </dl>

            <p className="aflc-reason"><Icon name="bulb" size={16} />{latest.reason}</p>

            {status.recent.length > 1 && (
              <div className="hb-history" aria-label="Recent decisions, newest first">
                <span className="tiny">Recent</span>
                <ol>
                  {status.recent.map((d, i) => (
                    <li key={`${d.created_at}-${i}`}
                      className={`hb-pip ${d.decision.toLowerCase()}`}
                      title={`${d.decision} · ${d.ecl ?? ""} · ${new Date(d.created_at).toLocaleTimeString()}`}>
                      <Icon name={DECISION_ICON[d.decision] ?? "info"} size={11} strokeWidth={2.8} />
                      <span className="sr-only">{d.decision}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        ) : (
          <p className="muted hb-empty">
            No AFLC decision has been stored yet. The first one runs about 30 seconds after the server starts,
            or press <strong>Run now</strong>.
          </p>
        )}
      </div>
    </section>
  );
}
