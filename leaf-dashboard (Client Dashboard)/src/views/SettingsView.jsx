import React from "react";
import Icon from "../components/Icon";
import { Segmented } from "../components/ui";

const ALERTS = ["Temperature alerts", "CO₂ alerts", "Water level alerts", "AFLC notifications"];

export default function SettingsView({ theme, setTheme, textSize, setTextSize, onLogout }) {
  return (
    <div className="grid-3 settings-grid">
      <section className="card">
        <header className="card-head"><span className="icon-badge"><Icon name="sun" size={16} /></span><h3>Appearance</h3></header>

        <div className="setting-item">
          <div><label>Theme</label><p className="muted">Dark is easier on the eyes in a grow room.</p></div>
          <Segmented label="Theme" value={theme} onChange={setTheme}
            options={[{ key: "light", label: "Light", icon: "sun" }, { key: "dark", label: "Dark", icon: "moon" }]} />
        </div>

        <div className="setting-item">
          <div><label>Text size</label><p className="muted">Scales every label, value and chart.</p></div>
          <Segmented label="Text size" value={textSize} onChange={setTextSize}
            options={[{ key: "normal", label: "Normal" }, { key: "large", label: "Large" }]} />
        </div>
      </section>

      <section className="card">
        <header className="card-head"><span className="icon-badge"><Icon name="bell" size={16} /></span><h3>Alerts</h3></header>
        {ALERTS.map((label, i) => (
          <div className="setting-item" key={label}>
            <label htmlFor={`alert-${i}`}>{label}</label>
            <input id={`alert-${i}`} type="checkbox" defaultChecked className="toggle-switch" />
          </div>
        ))}
      </section>

      <section className="card">
        <header className="card-head"><span className="icon-badge"><Icon name="info" size={16} /></span><h3>About</h3></header>
        <div className="about">
          <strong>VertiFarmVision v1.0</strong>
          <p className="muted">Vertical farm monitoring system with an Adaptive Fuzzy Logic Controller</p>
          <p className="muted">Colegio de Muntinlupa</p>
          <button className="btn ghost" onClick={onLogout}><Icon name="logout" size={16} />Log out</button>
        </div>
      </section>
    </div>
  );
}
