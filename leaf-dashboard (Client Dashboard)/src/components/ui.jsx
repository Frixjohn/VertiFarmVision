import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useDismiss } from "../hooks/useDashboardHooks";

const STATUS_ICON = { ok: "check", low: "arrowDown", high: "arrowUp", unknown: "info" };

/** Status is always icon + word (never colour alone), so it works for colour-blind users. */
export function StatusPill({ status, children }) {
  return (
    <span className={`pill tone-${status.tone}`}>
      <Icon name={STATUS_ICON[status.state] ?? "info"} size={12} strokeWidth={2.6} />
      {children ?? status.label}
    </span>
  );
}

/** Icon-only status for tight spaces. Shape (✓ / ↑ / ↓) + colour, with the word as its accessible name. */
export function StatusIcon({ status }) {
  return (
    <span className={`status-icon tone-${status.tone}`} role="img" aria-label={status.label} title={status.label}>
      <Icon name={STATUS_ICON[status.state] ?? "info"} size={13} strokeWidth={2.8} />
    </span>
  );
}

export function SectionHeader({ title, subtitle, children }) {
  return (
    <div className="section-header">
      <div>
        <h3>{title}</h3>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children && <div className="section-tools">{children}</div>}
    </div>
  );
}

export function Segmented({ label, options, value, onChange, className = "" }) {
  return (
    <div className={`segmented ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={value === o.key ? "active" : ""}
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Toasts ────────────────────────────────────────────────────────────────────
const TOAST_ICON = { success: "checkCircle", error: "alert", warning: "alert", info: "info" };

export function Toast({ message, type = "success", onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, type === "warning" ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [onClose, type]);

  return (
    <div className={`toast toast-${type}`}>
      <Icon name={TOAST_ICON[type] ?? "info"} size={18} className="toast-icon" />
      <span className="toast-msg">{message}</span>
      <button className="toast-close" onClick={onClose} aria-label="Dismiss notification">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

export function ToastStack({ toasts, onRemove }) {
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} message={t.message} type={t.type} onClose={() => onRemove(t.id)} />
      ))}
    </div>
  );
}

// ── Sensor edit dialog ────────────────────────────────────────────────────────
export function SensorEditModal({ sensor, onSave, onClose }) {
  const [value, setValue] = useState(sensor.value);
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.querySelector("input")?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clamp = (v) => Math.min(sensor.max, Math.max(sensor.min, v));
  const unit = sensor.unit.trim();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="edit-title"
        ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <h3 id="edit-title">Edit {sensor.name}</h3>
        <div className="modal-body">
          <div className="modal-readout">
            <input
              type="number"
              aria-label={`${sensor.name} value`}
              min={sensor.min} max={sensor.max} step={sensor.step}
              value={value}
              onChange={(e) => setValue(e.target.value === "" ? "" : parseFloat(e.target.value))}
              onBlur={() => setValue((v) => (v === "" ? sensor.value : clamp(v)))}
            />
            <span>{unit}</span>
          </div>
          <input
            type="range" className="range-input"
            aria-label={`${sensor.name} slider`}
            min={sensor.min} max={sensor.max} step={sensor.step}
            value={value === "" ? sensor.value : value}
            onChange={(e) => setValue(parseFloat(e.target.value))}
          />
          <div className="range-bounds"><span>{sensor.min}{unit}</span><span>{sensor.max}{unit}</span></div>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => { onSave(value === "" ? sensor.value : clamp(value)); onClose(); }}>
            Save value
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Notification bell + log panel ─────────────────────────────────────────────
const LOG_ICON = { image: "camera", success: "checkCircle", error: "alert", warning: "alert", info: "info" };

export function NotificationBell({ log, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, () => setOpen(false), ref);

  return (
    <div className="notif-wrapper" ref={ref}>
      <button
        className={`icon-btn ${open ? "active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${log.length ? `, ${log.length} in log` : ""}`}
        aria-expanded={open}
      >
        <Icon name="bell" size={19} />
        {log.length > 0 && <span className="notif-count">{log.length > 9 ? "9+" : log.length}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notification log">
          <div className="notif-panel-head">
            <strong>Notification log</strong>
            <button className="link-btn" onClick={() => { onClear(); setOpen(false); }}>Clear all</button>
          </div>
          <div className="notif-list">
            {log.length === 0 ? (
              <div className="notif-empty">
                <Icon name="bell" size={22} />
                <span>No notifications yet</span>
              </div>
            ) : (
              log.map((n) => {
                const type = n.type === "image" ? "success" : n.type;
                return (
                  <div key={n.id} className={`notif-item notif-${type}`}>
                    <Icon name={LOG_ICON[n.type] ?? "info"} size={17} className="notif-icon" />
                    <div className="notif-body">
                      <div className="notif-msg">{n.message}</div>
                      {n.imageData && (
                        <img className="notif-img" src={n.imageData} alt="Plant snapshot"
                          onClick={() => window.open(n.imageData, "_blank")} title="Open full size" />
                      )}
                      {n.mlResult && (
                        <span className={`pill ${n.mlResult.label === "healthy" ? "tone-success" : "tone-danger"}`}>
                          <Icon name={n.mlResult.label === "healthy" ? "leaf" : "alert"} size={12} />
                          {n.mlResult.label === "healthy" ? "Healthy" : "Diseased"} · {n.mlResult.confidence}%
                        </span>
                      )}
                      <div className="notif-time">{n.time}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
