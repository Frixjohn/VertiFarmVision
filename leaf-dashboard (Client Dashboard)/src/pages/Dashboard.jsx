import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { nodeService, aflcService } from '../api/services';

// ── Count-up animation hook ───────────────────────────────────────────────────
function useCountUp(target, duration = 1000) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const start = performance.now();
    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setValue(Math.round((target) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return value;
}

// ── AFLC Fuzzy Logic ──────────────────────────────────────────────────────────
function calculateAFLCDecision({ temperature, humidity, soilMoisture, soilPH }) {
  let score = 0;
  if (soilMoisture < 60) score += 3;
  else if (soilMoisture < 70) score += 1;
  else if (soilMoisture > 85) score -= 2;
  if (temperature > 28) score += 2;
  else if (temperature > 26) score += 1;
  if (humidity < 55) score += 2;
  else if (humidity < 65) score += 1;
  if (soilPH < 6.0 || soilPH > 7.2) score += 0.5;
  if (score >= 3) return { decision: 'IRRIGATE', confidence: Math.min(95, 70 + score * 5), reason: 'Low moisture & environmental stress' };
  if (score >= 1.5) return { decision: 'MONITOR', confidence: 60, reason: 'Borderline conditions detected' };
  return { decision: 'OPTIMAL', confidence: Math.min(95, 80 + Math.abs(score) * 3), reason: 'Conditions within optimal range' };
}

// ── Leaf Particles ────────────────────────────────────────────────────────────
const LeafParticles = React.memo(function LeafParticles({ count = 16, theme }) {
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  useEffect(() => {
    const h = (e) => setMousePos({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    window.addEventListener('mousemove', h);
    return () => window.removeEventListener('mousemove', h);
  }, []);
  const seeds = useMemo(() => Array.from({ length: count }).map((_, i) => ({
    id: i,
    left: `${Math.round(Math.random() * 100)}%`,
    top: `${Math.round(Math.random() * 80)}%`,
    delay: `${(Math.random() * 5).toFixed(2)}s`,
    scale: (0.5 + Math.random() * 1.2).toFixed(2),
    rotate: Math.round(Math.random() * 360),
    hueShift: Math.round(Math.random() * 50) - 15,
    parallaxStrength: 0.5 + Math.random() * 1.5,
  })), [count]);
  return (
    <div className="leaf-field" aria-hidden="true">
      {seeds.map((s) => (
        <svg key={s.id} className="floating-leaf"
          style={{ left: s.left, top: s.top, animationDelay: s.delay,
            transform: `translate(${(mousePos.x - 0.5) * s.parallaxStrength * 30}px, ${(mousePos.y - 0.5) * s.parallaxStrength * 20}px) rotate(${s.rotate}deg) scale(${s.scale})`,
            filter: `hue-rotate(${s.hueShift}deg)`, transition: 'transform 0.3s ease-out' }}
          viewBox="0 0 64 64" width="52" height="52">
          <defs>
            <linearGradient id={`g${s.id}`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor={theme === 'dark' ? '#4a7a4e' : '#b6f0b0'} />
              <stop offset="60%" stopColor={theme === 'dark' ? '#2b5a38' : '#57b76a'} />
              <stop offset="100%" stopColor={theme === 'dark' ? '#143e20' : '#1f7a3e'} />
            </linearGradient>
          </defs>
          <path d="M2 32 C12 8, 40 2, 62 6 C46 22, 52 46, 34 56 C16 66, 4 54, 2 32 Z" fill={`url(#g${s.id})`} opacity="0.98" />
          <path d="M14 28 C26 20, 40 18, 54 22" stroke={theme === 'dark' ? '#ffffff30' : '#ffffff70'} strokeWidth="1.8" fill="none" opacity="0.3" />
        </svg>
      ))}
    </div>
  );
});

// ── Bar Chart ─────────────────────────────────────────────────────────────────
function AnimatedBarChart({ data = [], theme }) {
  const [hoveredBar, setHoveredBar] = useState(null);
  const max = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);
  return (
    <div className="chart-outer" role="img" aria-label="Sensor readings chart">
      {data.map((d, i) => {
        const heightPct = Math.round((d.value / max) * 100);
        const isHovered = hoveredBar === i;
        return (
          <div className="bar-wrap" key={d.label} onMouseEnter={() => setHoveredBar(i)} onMouseLeave={() => setHoveredBar(null)}>
            <div className={`bar-amount ${isHovered ? 'hovered' : ''}`}
              style={{ height: `${heightPct}%`, transitionDelay: `${i * 60}ms`,
                background: theme === 'dark'
                  ? `linear-gradient(180deg, ${isHovered ? '#4fc376' : '#3ca25e'}, ${isHovered ? '#267a42' : '#1b5a2e'})`
                  : `linear-gradient(180deg, ${isHovered ? '#8ae69e' : 'var(--leaf-2)'}, ${isHovered ? '#2e8b50' : 'var(--leaf-4)'})` }}
              title={`${d.label}: ${d.value}${d.unit || ''}`}>
              {isHovered && <div className="bar-tooltip"><strong>{d.value}{d.unit || ''}</strong><span>{d.label}</span></div>}
            </div>
            <div className="bar-label">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, accent = 'green', theme, icon, unit = '' }) {
  const animatedValue = useCountUp(value, 1200);
  return (
    <div className={`stat-card stat-${accent}`} role="region" aria-label={`${label}: ${value}`}>
      <div className="stat-top">
        <div className="stat-label-row">{icon && <span className="stat-icon">{icon}</span>}<div className="stat-label">{label}</div></div>
        <div className="stat-value" style={{ color: theme === 'dark' && accent === 'green' ? '#76d493' : undefined }}>{animatedValue}{unit}</div>
      </div>
      <div className="stat-sub muted"><span className="live-dot"></span> live</div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, type = 'success', onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`toast toast-${type}`}>
      <span className="toast-icon">{type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
      {message}
    </div>
  );
}

// ── Sensor Edit Modal ─────────────────────────────────────────────────────────
function SensorEditModal({ sensor, onSave, onClose, theme }) {
  const [value, setValue] = useState(sensor.value);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Edit {sensor.name}</h3>
        <div className="modal-body">
          <label>Current Value: {value}{sensor.unit}</label>
          <input type="range" min={sensor.min} max={sensor.max} step={sensor.step} value={value}
            onChange={(e) => setValue(parseFloat(e.target.value))} className="range-input" />
          <div className="range-value">{value}{sensor.unit}</div>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => { onSave(value); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState(() => localStorage.getItem('farmDash-theme') || 'light');
  const [activePage, setActivePage] = useState('Overview');
  const [toasts, setToasts] = useState([]);
  const [editingSensor, setEditingSensor] = useState(null);
  const [dbStatus, setDbStatus] = useState('connecting');
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [liveMsg, setLiveMsg] = useState('');

  // nodeData: { node1: { temperature, humidity, soilMoisture, soilPH, irrigationStatus, lastIrrigation }, node2: {...} }
  const [nodeData, setNodeData] = useState({});
  const [nodeIds, setNodeIds] = useState({}); // { node1: 1, node2: 2 }

  useEffect(() => { localStorage.setItem('farmDash-theme', theme); }, [theme]);

  // ── Load nodes from DB ──────────────────────────────────────────────────────
  const loadNodes = useCallback(async () => {
    try {
      const rows = await nodeService.getAll();
      const mapped = {};
      const ids = {};
      rows.forEach((row) => {
        mapped[row.name] = {
          temperature:      parseFloat(row.temperature),
          humidity:         parseFloat(row.humidity),
          soilMoisture:     parseFloat(row.soil_moisture),
          soilPH:           parseFloat(row.soil_ph),
          lux:              parseFloat(row.lux ?? 0),
          irrigationStatus: row.irrigation_status,
          lastIrrigation:   row.last_irrigation,
        };
        ids[row.name] = row.id;
      });
      setNodeData(mapped);
      setNodeIds(ids);
      setDbStatus('connected');
    } catch (err) {
      console.error('Failed to load nodes:', err.message);
      setDbStatus('offline');
      // Fallback so UI still renders
      if (Object.keys(nodeData).length === 0) {
        setNodeData({
          node1: { temperature: 24.5, humidity: 65, soilMoisture: 72, soilPH: 6.8, lux: 0, irrigationStatus: 'idle', lastIrrigation: 'N/A' },
          node2: { temperature: 23.8, humidity: 68, soilMoisture: 70, soilPH: 6.5, lux: 0, irrigationStatus: 'idle', lastIrrigation: 'N/A' },
        });
      }
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    loadNodes();
    const interval = setInterval(loadNodes, 10000);
    return () => clearInterval(interval);
  }, [loadNodes]);

  // ── WebSocket ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001');
    ws.onopen  = () => setWsStatus('connected');
    ws.onclose = () => setWsStatus('disconnected');
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (['sensor_update', 'irrigation_complete', 'irrigation_start'].includes(msg.type)) {
          loadNodes();
          if (msg.type === 'irrigation_complete') {
            setLiveMsg('💧 Irrigation complete!');
            setTimeout(() => setLiveMsg(''), 4000);
          }
        }
      } catch {}
    };
    return () => ws.close();
  }, [loadNodes]);

  // ── Log AFLC decisions to DB whenever node data changes ────────────────────
  useEffect(() => {
    if (Object.keys(nodeData).length === 0) return;
    Object.entries(nodeData).forEach(([nodeName, data]) => {
      const nodeId = nodeIds[nodeName];
      if (!nodeId) return;
      const aflc = calculateAFLCDecision(data);
      aflcService.logDecision(nodeId, aflc).catch(() => {});
    });
  }, [nodeData, nodeIds]);

  // ── Toasts ──────────────────────────────────────────────────────────────────
  const showToast = useCallback((message, type = 'success') => {
    setToasts(prev => [...prev, { id: Date.now(), message, type }]);
  }, []);
  const removeToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // ── Update sensor → save to DB ──────────────────────────────────────────────
  const updateSensor = useCallback(async (nodeName, sensorKey, value) => {
    const nodeId = nodeIds[nodeName];
    if (!nodeId) { showToast('DB not connected — change saved locally only', 'info'); setNodeData(prev => ({ ...prev, [nodeName]: { ...prev[nodeName], [sensorKey]: value } })); return; }
    try {
      await nodeService.updateSensors(nodeId, { [sensorKey]: value });
      setNodeData(prev => ({ ...prev, [nodeName]: { ...prev[nodeName], [sensorKey]: value } }));
      showToast(`${sensorKey} updated for ${nodeName}`, 'success');
    } catch (err) {
      showToast(`Failed to save: ${err.response?.data?.message || err.message}`, 'error');
    }
  }, [nodeIds, showToast]);

  // ── Manual irrigate → call backend ─────────────────────────────────────────
  const manualIrrigate = useCallback(async (nodeName) => {
    const nodeId = nodeIds[nodeName];
    if (!nodeId) { showToast('DB not connected', 'error'); return; }
    try {
      await nodeService.irrigate(nodeId, 'manual');
      setNodeData(prev => ({ ...prev, [nodeName]: { ...prev[nodeName], irrigationStatus: 'active', lastIrrigation: 'Just now' } }));
      showToast(`Manual irrigation started for ${nodeName}`, 'success');
      setTimeout(() => loadNodes(), 5500);
    } catch (err) {
      showToast(`Irrigation failed: ${err.response?.data?.message || err.message}`, 'error');
    }
  }, [nodeIds, showToast, loadNodes]);

  // ── Export CSV ──────────────────────────────────────────────────────────────
  const exportToExcel = useCallback(() => {
    let csv = `FarmDash Sensor Data Export\nExport Time: ${new Date().toLocaleString()}\n\n`;
    csv += 'Node,Temperature (°C),Humidity (%),Soil Moisture (%),Soil pH,Light (lx),Last Irrigation,AFLC Decision,AFLC Confidence\n';
    Object.entries(nodeData).forEach(([nodeName, data]) => {
      const aflc = calculateAFLCDecision(data);
      csv += `${nodeName},${data.temperature},${data.humidity},${data.soilMoisture},${data.soilPH},${Math.round(data.lux)},${data.lastIrrigation},${aflc.decision},${aflc.confidence}%\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `FarmDash_Data_${Date.now()}.csv`;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Data exported!', 'success');
  }, [nodeData, showToast]);

  // ── Computed values ─────────────────────────────────────────────────────────
  const n1 = nodeData.node1;
  const n2 = nodeData.node2;
  const avgTemp     = n1 && n2 ? ((n1.temperature + n2.temperature) / 2).toFixed(1) : 0;
  const avgHumidity = n1 && n2 ? Math.round((n1.humidity + n2.humidity) / 2) : 0;
  const avgMoisture = n1 && n2 ? Math.round((n1.soilMoisture + n2.soilMoisture) / 2) : 0;
  const avgPH       = n1 && n2 ? ((n1.soilPH + n2.soilPH) / 2).toFixed(1) : 0;
  const avgLux      = n1 && n2 ? Math.round((n1.lux + n2.lux) / 2) : 0;
  const temperatureChart = useMemo(() => n1 && n2 ? [{ label: 'Node 1', value: n1.temperature, unit: '°C' }, { label: 'Node 2', value: n2.temperature, unit: '°C' }] : [], [n1, n2]);
  const humidityChart    = useMemo(() => n1 && n2 ? [{ label: 'Node 1', value: n1.humidity, unit: '%' }, { label: 'Node 2', value: n2.humidity, unit: '%' }] : [], [n1, n2]);
  const luxChart         = useMemo(() => n1 && n2 ? [{ label: 'Node 1', value: Math.round(n1.lux), unit: ' lx' }, { label: 'Node 2', value: Math.round(n2.lux), unit: ' lx' }] : [], [n1, n2]);
  const aflcNode1 = useMemo(() => n1 ? calculateAFLCDecision(n1) : null, [n1]);
  const aflcNode2 = useMemo(() => n2 ? calculateAFLCDecision(n2) : null, [n2]);

  if (!n1 || !n2) {
    return (
      <div className={`app theme-${theme}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ color: 'var(--leaf-3)', fontSize: 18 }}>Loading dashboard…</div>
      </div>
    );
  }

  return (
    <div className={`app theme-${theme}`}>
      <LeafParticles count={18} theme={theme} />

      <div className="toast-container">
        {toasts.map(toast => <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />)}
      </div>

      {editingSensor && (
        <SensorEditModal sensor={editingSensor}
          onSave={(value) => updateSensor(editingSensor.node, editingSensor.key, value)}
          onClose={() => setEditingSensor(null)} theme={theme} />
      )}

      {/* ── Sidebar ── */}
      <aside className="sidebar glass">
        <div className="brand">
          <div>
            <h1>FarmDash</h1>
            <div className="muted tiny">Vertical Farm Monitor</div>
          </div>
        </div>

        <nav className="nav">
          {[{ name: 'Overview', icon: '📊' }, { name: 'Sensors', icon: '🌡️' }, { name: 'Nodes', icon: '📡' }, { name: 'Settings', icon: '⚙️' }].map((p) => (
            <button key={p.name} className={`nav-btn ${activePage === p.name ? 'active' : ''}`} onClick={() => setActivePage(p.name)}>
              <span className="nav-icon">{p.icon}</span>{p.name}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="muted tiny">2 nodes active</div>
          <div className="status-badge">
            <span className="status-dot" style={{ background: dbStatus === 'connected' ? '#4caf50' : dbStatus === 'offline' ? '#f44336' : '#ff9800' }}></span>
            {dbStatus === 'connected' ? 'DB Connected' : dbStatus === 'offline' ? 'DB Offline' : 'Connecting…'}
          </div>
          <div className="status-badge" style={{ marginTop: 4 }}>
            <span className="status-dot" style={{ background: wsStatus === 'connected' ? '#4caf50' : '#aaa' }}></span>
            {wsStatus === 'connected' ? 'Live' : 'Polling (10s)'}
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="muted tiny" style={{ marginBottom: 4 }}>👤 {user?.email}</div>
            <button className="btn ghost" style={{ width: '100%', fontSize: 12 }} onClick={logout}>Logout</button>
          </div>
          <div className="authors">
            <div className="author-title">Developed by:</div>
            <div className="author-name">Chungwee, Frixjohn Q.</div>
            <div className="author-name">Yara, Marko Karlo A.</div>
            <div className="author-name">Martizano, Arabella Mae B.</div>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main">
        <header className="main-head">
          <div>
            <h2 className="page-title">{activePage}</h2>
            <div className="muted">Real-time vertical farm monitoring with AFLC</div>
          </div>
          <div className="actions">
            <button className="btn ghost" onClick={exportToExcel}><span className="btn-icon">📥</span>Export Data</button>
          </div>
        </header>

        {liveMsg && <div style={{ background: '#e8fff1', color: '#2e8b50', padding: '10px 32px', fontSize: 14, borderBottom: '1px solid #b6f0b0' }}>{liveMsg}</div>}

        {/* ── OVERVIEW ── */}
        {activePage === 'Overview' && (
          <>
            <section className="stats-row">
              <StatCard label="Avg Temp"     value={parseFloat(avgTemp)}     accent="teal"   theme={theme} icon="🌡️" unit="°C" />
              <StatCard label="Avg Humidity" value={avgHumidity}              accent="blue"   theme={theme} icon="💧" unit="%" />
              <StatCard label="Avg Moisture" value={avgMoisture}              accent="green"  theme={theme} icon="🌱" unit="%" />
              <StatCard label="Avg pH"       value={parseFloat(avgPH)}       accent="purple" theme={theme} icon="⚗️" />
              <StatCard label="Avg Light"    value={avgLux}                  accent="teal"   theme={theme} icon="☀️" unit=" lx" />
            </section>

            <section className="aflc-section">
              <div className="section-header"><h3>AFLC Status</h3><span className="badge">Adaptive Fuzzy Logic</span></div>
              <div className="aflc-grid">
                {[{ label: 'Node 1', data: n1, aflc: aflcNode1 }, { label: 'Node 2', data: n2, aflc: aflcNode2 }].map(({ label, data, aflc }) => (
                  <div key={label} className="aflc-card">
                    <div className="aflc-header">
                      <h4>{label} - AFLC Decision</h4>
                      <span className={`aflc-badge ${aflc.decision.toLowerCase()}`}>{aflc.decision}</span>
                    </div>
                    <div className="aflc-body">
                      <div className="aflc-confidence"><span className="confidence-label">Confidence:</span><span className="confidence-value">{aflc.confidence}%</span></div>
                      <div className="aflc-reason"><span className="reason-icon">💡</span><span>{aflc.reason}</span></div>
                      <div className="aflc-metrics">
                        <div className="metric-item"><span>Moisture: {data.soilMoisture}%</span><span className={data.soilMoisture >= 65 && data.soilMoisture <= 80 ? 'status-ok' : 'status-warn'}>{data.soilMoisture >= 65 && data.soilMoisture <= 80 ? '✓' : '⚠'}</span></div>
                        <div className="metric-item"><span>Temp: {data.temperature}°C</span><span className={data.temperature >= 22 && data.temperature <= 26 ? 'status-ok' : 'status-warn'}>{data.temperature >= 22 && data.temperature <= 26 ? '✓' : '⚠'}</span></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="charts-grid">
              <div className="card big-card">
                <div className="card-top"><div><h3>Temperature by Node</h3><div className="muted tiny">Current readings</div></div></div>
                <AnimatedBarChart data={temperatureChart} theme={theme} />
              </div>
              <div className="card big-card">
                <div className="card-top"><div><h3>Humidity by Node</h3><div className="muted tiny">Current readings</div></div></div>
                <AnimatedBarChart data={humidityChart} theme={theme} />
              </div>
              <div className="card big-card">
                <div className="card-top"><div><h3>Light (Lux) by Node</h3><div className="muted tiny">BH1750 readings</div></div></div>
                <AnimatedBarChart data={luxChart} theme={theme} />
              </div>
            </section>

            <section className="charts-grid">
              {[{ label: 'Node 1', data: n1 }, { label: 'Node 2', data: n2 }].map(({ label, data }) => (
                <div key={label} className="card big-card">
                  <div className="card-top"><div><h3>{label} Status</h3><div className="muted tiny">All sensors</div></div></div>
                  <div className="node-summary">
                    <div className="summary-item"><span>🌡️ Temperature:</span><strong>{data.temperature}°C</strong></div>
                    <div className="summary-item"><span>💧 Humidity:</span><strong>{data.humidity}%</strong></div>
                    <div className="summary-item"><span>🌱 Soil Moisture:</span><strong>{data.soilMoisture}%</strong></div>
                    <div className="summary-item"><span>⚗️ Soil pH:</span><strong>{data.soilPH}</strong></div>
                    <div className="summary-item"><span>☀️ Light:</span><strong>{Math.round(data.lux)} lx</strong></div>
                  </div>
                </div>
              ))}
            </section>
          </>
        )}

        {/* ── SENSORS ── */}
        {activePage === 'Sensors' && (
          <section className="sensors">
            <div className="section-header"><h3>Sensor Readings</h3><span className="badge">Live Data</span></div>
            <div className="sensor-grid">
              {[
                { nodeKey: 'node1', label: 'Node 1', data: n1 },
                { nodeKey: 'node2', label: 'Node 2', data: n2 },
              ].flatMap(({ nodeKey, label, data }) => [
                { key: 'temperature',  name: `${label} - Temperature`,   value: data.temperature,  unit: '°C', min: 15,  max: 35,  step: 0.1, ok: data.temperature >= 22 && data.temperature <= 26 },
                { key: 'humidity',     name: `${label} - Humidity`,      value: data.humidity,     unit: '%',  min: 40,  max: 90,  step: 1,   ok: data.humidity >= 60 && data.humidity <= 75 },
                { key: 'soilMoisture', name: `${label} - Soil Moisture`, value: data.soilMoisture, unit: '%',  min: 40,  max: 95,  step: 1,   ok: data.soilMoisture >= 65 && data.soilMoisture <= 80 },
                { key: 'soilPH',       name: `${label} - Soil pH`,       value: data.soilPH,       unit: '',   min: 5.5, max: 7.5, step: 0.1, ok: data.soilPH >= 6.0 && data.soilPH <= 7.0 },
                { key: 'lux',          name: `${label} - Light`,         value: Math.round(data.lux), unit: ' lx', min: 0, max: 100000, step: 1, ok: data.lux >= 5000 && data.lux <= 80000, readOnly: true },
              ].map((sensor) => (
                <div key={`${nodeKey}-${sensor.key}`} className="sensor-card">
                  <div className="sensor-header">
                    <h4>{sensor.name}</h4>
                    {!sensor.readOnly && (
                      <button className="btn-edit" onClick={() => setEditingSensor({ node: nodeKey, key: sensor.key, name: sensor.name, value: sensor.value, unit: sensor.unit, min: sensor.min, max: sensor.max, step: sensor.step })}>✏️</button>
                    )}
                  </div>
                  <div className="sensor-value">{sensor.value}{sensor.unit}</div>
                  <div className="sensor-status" style={{ color: sensor.ok ? '#4caf50' : '#ff9800' }}>{sensor.ok ? '✓ Optimal' : '⚠ Check Range'}</div>
                </div>
              )))}
            </div>
          </section>
        )}

        {/* ── NODES ── */}
        {activePage === 'Nodes' && (
          <section className="nodes">
            <div className="section-header"><h3>Node Control & Irrigation</h3><span className="badge">2 Active</span></div>
            <div className="node-cards">
              {[{ key: 'node1', label: 'Node 1 (Layer 1)', data: n1 }, { key: 'node2', label: 'Node 2 (Layer 2)', data: n2 }].map(({ key, label, data }) => (
                <div key={key} className="node-detail-card">
                  <div className="node-detail-header"><h3>📡 {label}</h3><span className="node-status-badge active">Active</span></div>
                  <div className="node-detail-body">
                    <div className="detail-row"><span className="detail-label">🌡️ Temperature:</span><span className="detail-value">{data.temperature}°C</span></div>
                    <div className="detail-row"><span className="detail-label">💧 Humidity:</span><span className="detail-value">{data.humidity}%</span></div>
                    <div className="detail-row"><span className="detail-label">🌱 Soil Moisture:</span><span className="detail-value">{data.soilMoisture}%</span></div>
                    <div className="detail-row"><span className="detail-label">⚗️ Soil pH:</span><span className="detail-value">{data.soilPH}</span></div>
                    <div className="detail-row"><span className="detail-label">☀️ Light:</span><span className="detail-value">{Math.round(data.lux)} lx</span></div>
                    <div className="irrigation-control">
                      <div className="irrigation-status"><span className="irrigation-label">Last Irrigation:</span><span className="irrigation-time">{data.lastIrrigation}</span></div>
                      <div className="irrigation-status"><span className="irrigation-label">Status:</span>
                        <span className={`irrigation-badge ${data.irrigationStatus}`}>{data.irrigationStatus === 'active' ? '💧 Irrigating...' : '✓ Idle'}</span>
                      </div>
                      <button className="btn-irrigate" onClick={() => manualIrrigate(key)} disabled={data.irrigationStatus === 'active'}>💧 Manual Irrigate</button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="node-detail-card waiting">
                <div className="node-detail-header"><h3>📡 Node 3 (Layer 3)</h3><span className="node-status-badge waiting">Waiting</span></div>
                <div className="node-detail-body waiting-state">
                  <div className="waiting-icon">⏳</div>
                  <p>Waiting for hardware connection...</p>
                  <p className="muted tiny">Node will appear automatically when connected</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── SETTINGS ── */}
        {activePage === 'Settings' && (
          <section className="settings">
            <h3>System Settings</h3>
            <div className="settings-grid">
              <div className="setting-card">
                <div className="setting-header"><span className="setting-icon">🎨</span><h4>Appearance</h4></div>
                <div className="setting-item">
                  <label>Theme</label>
                  <div className="toggle">
                    <button className={`btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>☀️ Light</button>
                    <button className={`btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>🌙 Dark</button>
                  </div>
                </div>
              </div>
              <div className="setting-card">
                <div className="setting-header"><span className="setting-icon">🔔</span><h4>Alerts</h4></div>
                <div className="setting-item"><label>Temperature alerts</label><input type="checkbox" defaultChecked className="toggle-switch" /></div>
                <div className="setting-item"><label>AFLC notifications</label><input type="checkbox" defaultChecked className="toggle-switch" /></div>
              </div>
              <div className="setting-card">
                <div className="setting-header"><span className="setting-icon">📊</span><h4>Data</h4></div>
                <div className="setting-item"><label>Log interval</label><select className="select"><option>5 min</option><option>10 min</option><option>30 min</option></select></div>
              </div>
              <div className="setting-card">
                <div className="setting-header"><span className="setting-icon">ℹ️</span><h4>About</h4></div>
                <div className="about-content">
                  <p><strong>FarmDash v1.0</strong></p>
                  <p className="muted tiny">Vertical Farm Monitoring System</p>
                  <p className="muted tiny">with Adaptive Fuzzy Logic Controller</p>
                  <p className="muted tiny">Colegio de Muntinlupa</p>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
