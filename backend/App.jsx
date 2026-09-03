import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import axios from "axios";

// ── API client (all calls go to /api, Vite proxies to Express on :3001) ───────
const api = axios.create({ baseURL: "/api", headers: { "Content-Type": "application/json" } });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("farmDash-token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    const isLogin = error.config?.url?.includes("/auth/login");
    if (error.response?.status === 401 && !isLogin) {
      localStorage.removeItem("farmDash-token");
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

// ── Count-up hook ─────────────────────────────────────────────────────────────
function useCountUp(target, duration = 1000) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const to = target;

    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setValue(Math.round(from + (to - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return value;
}

// ── Leaf Particles ────────────────────────────────────────────────────────────
const LeafParticles = React.memo(function LeafParticles({ count = 16, theme }) {
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const seeds = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => ({
      id: i,
      left: `${Math.round(Math.random() * 100)}%`,
      top: `${Math.round(Math.random() * 80)}%`,
      delay: `${(Math.random() * 5).toFixed(2)}s`,
      scale: (0.5 + Math.random() * 1.2).toFixed(2),
      rotate: Math.round(Math.random() * 360),
      hueShift: Math.round(Math.random() * 50) - 15,
      parallaxStrength: 0.5 + Math.random() * 1.5,
    }));
  }, [count]);

  return (
    <div className="leaf-field" aria-hidden="true">
      {seeds.map((s) => (
        <svg
          key={s.id}
          className="floating-leaf"
          style={{
            left: s.left,
            top: s.top,
            animationDelay: s.delay,
            transform: `translate(${(mousePos.x - 0.5) * s.parallaxStrength * 30}px, ${(mousePos.y - 0.5) * s.parallaxStrength * 20}px) rotate(${s.rotate}deg) scale(${s.scale})`,
            filter: `hue-rotate(${s.hueShift}deg)`,
            transition: "transform 0.3s ease-out",
          }}
          viewBox="0 0 64 64"
          width="52"
          height="52"
        >
          <defs>
            <linearGradient id={`g${s.id}`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor={theme === "dark" ? "#4a7a4e" : "#b6f0b0"} />
              <stop offset="60%" stopColor={theme === "dark" ? "#2b5a38" : "#57b76a"} />
              <stop offset="100%" stopColor={theme === "dark" ? "#143e20" : "#1f7a3e"} />
            </linearGradient>
          </defs>
          <path
            d="M2 32 C12 8, 40 2, 62 6 C46 22, 52 46, 34 56 C16 66, 4 54, 2 32 Z"
            fill={`url(#g${s.id})`}
            opacity="0.98"
          />
          <path
            d="M14 28 C26 20, 40 18, 54 22"
            stroke={theme === "dark" ? "#ffffff30" : "#ffffff70"}
            strokeWidth="1.8"
            fill="none"
            opacity="0.3"
          />
        </svg>
      ))}
    </div>
  );
});

// ── Animated Bar Chart ────────────────────────────────────────────────────────
function AnimatedBarChart({ data = [], theme }) {
  const [hoveredBar, setHoveredBar] = useState(null);
  const max = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);

  return (
    <div className="chart-outer" role="img" aria-label="Sensor readings chart">
      {data.map((d, i) => {
        const heightPct = Math.round((d.value / max) * 100);
        const isHovered = hoveredBar === i;

        return (
          <div
            className="bar-wrap"
            key={d.label}
            onMouseEnter={() => setHoveredBar(i)}
            onMouseLeave={() => setHoveredBar(null)}
          >
            <div
              className={`bar-amount ${isHovered ? "hovered" : ""}`}
              style={{
                height: `${heightPct}%`,
                transitionDelay: `${i * 60}ms`,
                background: theme === "dark"
                  ? `linear-gradient(180deg, ${isHovered ? "#4fc376" : "#3ca25e"}, ${isHovered ? "#267a42" : "#1b5a2e"})`
                  : `linear-gradient(180deg, ${isHovered ? "#8ae69e" : "var(--leaf-2)"}, ${isHovered ? "#2e8b50" : "var(--leaf-4)"})`,
              }}
              title={`${d.label}: ${d.value}${d.unit || ""}`}
            >
              {isHovered && (
                <div className="bar-tooltip">
                  <strong>{d.value}{d.unit || ""}</strong>
                  <span>{d.label}</span>
                </div>
              )}
            </div>
            <div className="bar-label">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, accent = "green", theme, icon, unit = "" }) {
  const animatedValue = useCountUp(value, 1200);
  const prevValue = useRef(value);
  const [isIncreasing, setIsIncreasing] = useState(false);

  useEffect(() => {
    if (value > prevValue.current) {
      setIsIncreasing(true);
      setTimeout(() => setIsIncreasing(false), 600);
    }
    prevValue.current = value;
  }, [value]);

  return (
    <div className={`stat-card stat-${accent} ${isIncreasing ? "pulse" : ""}`} role="region" aria-label={`${label}: ${value}`}>
      <div className="stat-top">
        <div className="stat-label-row">
          {icon && <span className="stat-icon">{icon}</span>}
          <div className="stat-label">{label}</div>
        </div>
        <div className="stat-value" style={{ color: theme === "dark" && accent === "green" ? "#76d493" : undefined }}>
          {animatedValue}{unit}
        </div>
      </div>
      <div className="stat-sub muted">
        <span className="live-dot"></span> live
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, type = "success", onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, type === "warning" ? 8000 : 3000);
    return () => clearTimeout(timer);
  }, [onClose, type]);

  return (
    <div className={`toast toast-${type}`}>
      <span className="toast-icon">
        {type === "success" ? "✅" : type === "error" ? "❌" : type === "warning" ? "⚠️" : "ℹ️"}
      </span>
      {message}
      <button className="toast-close" onClick={onClose}>×</button>
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
          <input
            type="range"
            min={sensor.min}
            max={sensor.max}
            step={sensor.step}
            value={value}
            onChange={(e) => setValue(parseFloat(e.target.value))}
            className="range-input"
          />
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

// ── AFLC Decision Logic (uses Temp, Humidity, CO₂) ───────────────────────────
function calculateAFLCDecision(nodeData) {
  const { temperature, humidity, co2 } = nodeData;
  let irrigationScore = 0;

  if (temperature > 28) irrigationScore += 2;
  else if (temperature > 26) irrigationScore += 1;

  if (humidity < 55) irrigationScore += 2;
  else if (humidity < 65) irrigationScore += 1;
  else if (humidity > 80) irrigationScore -= 1;

  // High CO₂ indicates plant stress / poor air exchange → factor in
  if (co2 > 1500) irrigationScore += 1.5;
  else if (co2 > 1200) irrigationScore += 0.5;

  if (irrigationScore >= 3) return { decision: "IRRIGATE", confidence: Math.min(95, 70 + irrigationScore * 5), reason: "High stress — temp/humidity/CO₂ out of range" };
  else if (irrigationScore >= 1.5) return { decision: "MONITOR", confidence: 60, reason: "Borderline conditions detected" };
  else return { decision: "OPTIMAL", confidence: Math.min(95, 80 + Math.abs(irrigationScore) * 3), reason: "Conditions within optimal range" };
}

// ── Water Level Warning Banner ────────────────────────────────────────────────
function WaterLevelAlert({ onDismiss }) {
  return (
    <div className="water-alert-banner" role="alert">
      <div className="water-alert-icon">🚨</div>
      <div className="water-alert-body">
        <strong>RESERVOIR LOW WATER LEVEL DETECTED</strong>
        <span>The water level sensor has been triggered. Please refill the reservoir immediately to prevent pump damage and nutrient disruption.</span>
      </div>
      <button className="water-alert-dismiss" onClick={onDismiss}>Acknowledge</button>
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, theme }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("farmDash-token", data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.response?.data?.message || "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`app theme-${theme}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <LeafParticles count={14} theme={theme} />
      <div className="login-card">
        <div className="login-logo-wrap">
          <img src="/images.png" alt="FarmDash Logo" className="brand-logo login-logo" />
        </div>
        <h2 className="login-title">VertiFarmVision</h2>
        <p className="login-sub muted">Vertical Farm Monitor — Sign in</p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-label muted">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@farmdash.com"
              required
              className="login-input"
            />
          </div>
          <div className="login-field">
            <label className="login-label muted">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="login-input"
            />
          </div>
          <button type="submit" disabled={loading} className="btn primary login-btn" style={{ opacity: loading ? 0.7 : 1 }}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p className="muted tiny" style={{ textAlign: "center", marginTop: 20 }}>Colegio de Muntinlupa — AFLC System</p>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("farmDash-theme") || "light");
  const [activePage, setActivePage] = useState("Overview");
  const [toasts, setToasts] = useState([]);
  const [notificationLog, setNotificationLog] = useState([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [editingSensor, setEditingSensor] = useState(null);
  const [waterAlertDismissed, setWaterAlertDismissed] = useState(false);
  const prevWaterLevel = useRef(false);

  // Auth
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // ── Node sensor data: Temp, Humidity, CO₂, Light ──────────────────────────
  const [nodeData, setNodeData] = useState({
    node1: { temperature: 24.5, humidity: 65, co2: 800, lux: 0, lastIrrigation: "2 hours ago", irrigationStatus: "idle" },
    node2: { temperature: 23.8, humidity: 68, co2: 820, lux: 0, lastIrrigation: "3 hours ago", irrigationStatus: "idle" },
  });
  const [nodeIds, setNodeIds] = useState({});
  const [dbStatus, setDbStatus] = useState("connecting");

  // ── Reservoir sensor data (universal — not node-based) ────────────────────
  const [reservoirData, setReservoirData] = useState({
    waterPH: 6.2,
    tds: 850,
    turbidity: 12,
    waterLevelTriggered: false,
    motorRunning: false,
    motorState: 'STOPPED',
  });
  const [motorTriggering, setMotorTriggering] = useState(false);

  // ── Check for existing session on load ────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem("farmDash-token");
    if (token) {
      api.get("/auth/me")
        .then(({ data }) => setUser(data))
        .catch(() => localStorage.removeItem("farmDash-token"))
        .finally(() => setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("farmDash-theme", theme);
    // Apply class to <html> so CSS vars cascade to html/body/#root backgrounds
    document.documentElement.classList.toggle("theme-dark", theme === "dark");
  }, [theme]);

  // ── Load nodes from PostgreSQL ─────────────────────────────────────────────
  const loadNodes = useCallback(async () => {
    try {
      const { data: rows } = await api.get("/nodes");
      const mapped = {};
      const ids = {};
      const keyMap = { "NODE-01": "node1", "NODE-02": "node2" };

      rows.forEach((row) => {
        const key = keyMap[row.name] || row.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        mapped[key] = {
          temperature:      parseFloat(row.temperature),
          humidity:         parseFloat(row.humidity),
          co2:              parseFloat(row.co2 ?? 800),
          lux:              parseFloat(row.lux ?? 0),
          irrigationStatus: row.irrigation_status,
          lastIrrigation:   row.last_irrigation,
        };
        ids[key] = row.id;
      });
      setNodeData(mapped);
      setNodeIds(ids);
      setDbStatus("connected");
    } catch {
      setDbStatus("offline");
    }
  }, []);

  // ── Load reservoir data ────────────────────────────────────────────────────
  const loadReservoir = useCallback(async () => {
    try {
      const { data } = await api.get("/reservoir");
      setReservoirData({
        waterPH:             parseFloat(data.water_ph ?? 6.2),
        tds:                 parseFloat(data.tds ?? 850),
        turbidity:           parseFloat(data.turbidity ?? 12),
        waterLevelTriggered: Boolean(data.water_level_triggered),
        motorRunning:        Boolean(data.motor_running),
        motorState:          data.motor_state ?? 'STOPPED',
      });
    } catch {
      // Falls back to defaults silently
    }
  }, []);

  // ── Queue a motor run command — ESP32 picks it up on its next POST ─────────
  const triggerMotor = useCallback(async () => {
    setMotorTriggering(true);
    try {
      await api.post('/reservoir/motor/run');
      showToast('⚙️ Motor command sent — ESP32 will run for 15 seconds.', 'success');
    } catch {
      showToast('❌ Failed to send motor command.', 'error');
    } finally {
      // Keep button disabled for 16s (15s run + 1s buffer) so user can't spam
      setTimeout(() => setMotorTriggering(false), 16000);
    }
  }, [showToast]);

  useEffect(() => {
    if (!user) return;
    loadNodes();
    loadReservoir();
    const nodeInterval = setInterval(loadNodes, 10000);
    const reservoirInterval = setInterval(loadReservoir, 8000);
    return () => { clearInterval(nodeInterval); clearInterval(reservoirInterval); };
  }, [user, loadNodes, loadReservoir]);

  // ── Water level alert: fire toast + reset banner dismiss when triggered ───
  useEffect(() => {
    if (reservoirData.waterLevelTriggered && !prevWaterLevel.current) {
      setWaterAlertDismissed(false);
      showToast("🚨 RESERVOIR LOW — Water level sensor triggered! Check reservoir immediately.", "warning");
    }
    prevWaterLevel.current = reservoirData.waterLevelTriggered;
  }, [reservoirData.waterLevelTriggered]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket for real-time backend events ─────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (["sensor_update", "irrigation_complete", "irrigation_start"].includes(msg.type)) {
          loadNodes();
        }
        if (msg.type === "reservoir_update") {
          loadReservoir();
        }
        if (msg.type === "water_level_alert") {
          setReservoirData(prev => ({ ...prev, waterLevelTriggered: true }));
        }
      } catch {}
    };
    return () => ws.close();
  }, [user, loadNodes, loadReservoir]);

  // ── Log AFLC decisions to DB on every data change ─────────────────────────
  useEffect(() => {
    if (!user || Object.keys(nodeIds).length === 0) return;
    Object.entries(nodeData).forEach(([nodeName, data]) => {
      const nodeId = nodeIds[nodeName];
      if (!nodeId) return;
      api.post(`/aflc/${nodeId}`, calculateAFLCDecision(data)).catch(() => {});
    });
  }, [nodeData, nodeIds, user]);

  // ── Toasts ─────────────────────────────────────────────────────────────────
  const showToast = useCallback((message, type = "success") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setNotificationLog(prev => [
      { id, message, type, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) },
      ...prev.slice(0, 49),
    ]);
  }, []);
  const removeToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // ── Update sensor → save to DB ─────────────────────────────────────────────
  const updateSensor = useCallback(async (node, sensor, value) => {
    const nodeId = nodeIds[node];
    if (nodeId) {
      try {
        await api.put(`/nodes/${nodeId}/sensors`, { [sensor]: value });
      } catch (err) {
        showToast(`Save failed: ${err.response?.data?.message || err.message}`, "error");
        return;
      }
    }
    setNodeData(prev => ({ ...prev, [node]: { ...prev[node], [sensor]: value } }));
    showToast(`${sensor} updated for ${node}`, "success");
  }, [nodeIds, showToast]);

  // ── Manual irrigate → calls backend ───────────────────────────────────────
  const manualIrrigate = useCallback(async (node) => {
    const nodeId = nodeIds[node];
    if (nodeId) {
      try {
        await api.post(`/nodes/${nodeId}/irrigate`, { triggeredBy: "manual" });
      } catch (err) {
        showToast(`Irrigation failed: ${err.response?.data?.message || err.message}`, "error");
        return;
      }
    }
    setNodeData(prev => ({ ...prev, [node]: { ...prev[node], irrigationStatus: "active", lastIrrigation: "Just now" } }));
    showToast(`Manual irrigation started for ${node}`, "success");
    setTimeout(() => {
      if (nodeId) {
        loadNodes();
      } else {
        setNodeData(prev => ({
          ...prev,
          [node]: { ...prev[node], irrigationStatus: "idle" }
        }));
        showToast(`Irrigation complete for ${node}`, "success");
      }
    }, 5500);
  }, [nodeIds, showToast, loadNodes]);

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    localStorage.removeItem("farmDash-token");
    setUser(null);
  }, []);

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const exportToExcel = useCallback(() => {
    const timestamp = new Date().toLocaleString();
    let csv = "FarmDash Sensor Data Export\n";
    csv += `Export Time: ${timestamp}\n\n`;
    csv += "Node,Temperature (°C),Humidity (%),CO2 (ppm),Light (lx),Last Irrigation,AFLC Decision,AFLC Confidence\n";
    Object.entries(nodeData).forEach(([nodeName, data]) => {
      const aflc = calculateAFLCDecision(data);
      csv += `${nodeName},${data.temperature},${data.humidity},${data.co2},${Math.round(data.lux)},${data.lastIrrigation},${aflc.decision},${aflc.confidence}%\n`;
    });
    csv += "\n\nReservoir Readings:\n";
    csv += `Water pH,${reservoirData.waterPH}\n`;
    csv += `TDS (ppm),${reservoirData.tds}\n`;
    csv += `Turbidity (NTU),${reservoirData.turbidity}\n`;
    csv += `Water Level Alert,${reservoirData.waterLevelTriggered ? "TRIGGERED" : "Normal"}\n`;
    csv += `Motor State,${reservoirData.motorState}\n`;
    csv += "\n\nOptimal Ranges (Node):\n";
    csv += "Temperature: 22–26°C\nHumidity: 60–75%\nCO2: 400–1200 ppm\n";
    csv += "\nOptimal Ranges (Reservoir):\n";
    csv += "Water pH: 5.5–7.0\nTDS: 500–1500 ppm\nTurbidity: <50 NTU\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FarmDash_Data_${Date.now()}.csv`;
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Data exported successfully!", "success");
  }, [nodeData, reservoirData, showToast]);

  // ── Computed averages (node-based) ─────────────────────────────────────────
  const avgTemp     = useMemo(() => ((nodeData.node1.temperature + nodeData.node2.temperature) / 2).toFixed(1), [nodeData]);
  const avgHumidity = useMemo(() => Math.round((nodeData.node1.humidity + nodeData.node2.humidity) / 2), [nodeData]);
  const avgCO2      = useMemo(() => Math.round((nodeData.node1.co2 + nodeData.node2.co2) / 2), [nodeData]);
  const avgLux      = useMemo(() => Math.round((nodeData.node1.lux + nodeData.node2.lux) / 2), [nodeData]);

  const temperatureChart = useMemo(() => [
    { label: "Node 1", value: nodeData.node1.temperature, unit: "°C" },
    { label: "Node 2", value: nodeData.node2.temperature, unit: "°C" },
  ], [nodeData]);

  const humidityChart = useMemo(() => [
    { label: "Node 1", value: nodeData.node1.humidity, unit: "%" },
    { label: "Node 2", value: nodeData.node2.humidity, unit: "%" },
  ], [nodeData]);

  const co2Chart = useMemo(() => [
    { label: "Node 1", value: nodeData.node1.co2, unit: " ppm" },
    { label: "Node 2", value: nodeData.node2.co2, unit: " ppm" },
  ], [nodeData]);

  const luxChart = useMemo(() => [
    { label: "Node 1", value: Math.round(nodeData.node1.lux), unit: " lx" },
    { label: "Node 2", value: Math.round(nodeData.node2.lux), unit: " lx" },
  ], [nodeData]);

  const aflcNode1 = useMemo(() => calculateAFLCDecision(nodeData.node1), [nodeData.node1]);
  const aflcNode2 = useMemo(() => calculateAFLCDecision(nodeData.node2), [nodeData.node2]);

  // ── Auth gates ─────────────────────────────────────────────────────────────
  if (!authChecked) {
    return (
      <div className={`app theme-${theme}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="muted">Loading…</div>
      </div>
    );
  }

  if (!user) return <LoginScreen onLogin={setUser} theme={theme} />;

  // ── Dashboard ──────────────────────────────────────────────────────────────
  return (
    <div className={`app theme-${theme}`}>
      <LeafParticles count={18} theme={theme} />

      <div className="toast-container">
        {toasts.map(toast => (
          <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
        ))}
      </div>

      {editingSensor && (
        <SensorEditModal
          sensor={editingSensor}
          onSave={(value) => updateSensor(editingSensor.node, editingSensor.key, value)}
          onClose={() => setEditingSensor(null)}
          theme={theme}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className="sidebar glass">
        <div className="brand">
          <img src="/images.png" alt="Logo" className="brand-logo" />
          <div>
            <h1>VertiFarmVision</h1>
            <div className="muted tiny">Vertical Farm Monitor</div>
          </div>
        </div>

        <nav className="nav">
          {[
            { name: "Overview", icon: "📊" },
            { name: "Sensors",  icon: "🌡️" },
            { name: "Nodes",    icon: "📡" },
            { name: "Settings", icon: "⚙️" },
          ].map((p) => (
            <button
              key={p.name}
              className={`nav-btn ${activePage === p.name ? "active" : ""}`}
              onClick={() => setActivePage(p.name)}
            >
              <span className="nav-icon">{p.icon}</span>{p.name}
              {p.name === "Sensors" && reservoirData.waterLevelTriggered && (
                <span className="nav-alert-dot" title="Water level alert">●</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="muted tiny">2 nodes active</div>
          <div className="status-badge">
            <span className="status-dot"></span>System Active
          </div>
          {reservoirData.waterLevelTriggered && (
            <div className="status-badge" style={{ background: "rgba(255,80,80,0.15)", color: "#ff5050", marginTop: 6 }}>
              <span className="status-dot" style={{ background: "#ff5050" }}></span>Reservoir Low
            </div>
          )}
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
            <div className="notif-wrapper">
              <button
                className={`btn ghost notif-btn ${showNotifPanel ? "active" : ""}`}
                onClick={() => setShowNotifPanel(p => !p)}
              >
                <span className="btn-icon">🔔</span>
                Notification Log
                {notificationLog.length > 0 && (
                  <span className="notif-count">{notificationLog.length}</span>
                )}
              </button>
              {showNotifPanel && (
                <div className="notif-panel">
                  <div className="notif-panel-head">
                    <strong>Notification Log</strong>
                    <button
                      className="notif-clear"
                      onClick={() => { setNotificationLog([]); setShowNotifPanel(false); }}
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="notif-list">
                    {notificationLog.length === 0 ? (
                      <div className="notif-empty">No notifications yet</div>
                    ) : (
                      notificationLog.map(n => (
                        <div key={n.id} className={`notif-item notif-item-${n.type}`}>
                          <span className="notif-icon">
                            {n.type === "success" ? "✅" : n.type === "error" ? "❌" : n.type === "warning" ? "⚠️" : "ℹ️"}
                          </span>
                          <div className="notif-body">
                            <div className="notif-msg">{n.message}</div>
                            <div className="notif-time">{n.time}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ── Global Water Level Alert Banner ── */}
        {reservoirData.waterLevelTriggered && !waterAlertDismissed && (
          <WaterLevelAlert onDismiss={() => setWaterAlertDismissed(true)} />
        )}

        {/* ── OVERVIEW ── */}
        {activePage === "Overview" && (
          <>
            {/* Node averages */}
            <section className="stats-row">
              <StatCard label="Avg Temp"     value={parseFloat(avgTemp)}  accent="teal"   theme={theme} icon="🌡️" unit="°C" />
              <StatCard label="Avg Humidity" value={avgHumidity}           accent="blue"   theme={theme} icon="💧" unit="%" />
              <StatCard label="Avg CO₂"      value={avgCO2}               accent="purple" theme={theme} icon="🫧" unit=" ppm" />
              <StatCard label="Avg Light"    value={avgLux}               accent="teal"   theme={theme} icon="☀️" unit=" lx" />
            </section>

            {/* Reservoir quick-status strip */}
            <section className="reservoir-strip">
              <div className="reservoir-strip-title">
                <span>🧪</span>
                <h3>Reservoir Status</h3>
                <span className={`badge ${reservoirData.waterLevelTriggered ? "badge-danger" : ""}`}>
                  {reservoirData.waterLevelTriggered ? "⚠ Low Water" : "Universal Sensor"}
                </span>
              </div>
              <div className="reservoir-strip-grid">
                <div className="res-strip-item">
                  <span className="res-strip-icon">🧪</span>
                  <div>
                    <div className="res-strip-label">Water pH</div>
                    <div className="res-strip-value">{reservoirData.waterPH}</div>
                  </div>
                  <span className="sensor-status" style={{ color: reservoirData.waterPH >= 5.5 && reservoirData.waterPH <= 7.0 ? "#4caf50" : "#ff9800" }}>
                    {reservoirData.waterPH >= 5.5 && reservoirData.waterPH <= 7.0 ? "✓" : "⚠"}
                  </span>
                </div>
                <div className="res-strip-item">
                  <span className="res-strip-icon">⚡</span>
                  <div>
                    <div className="res-strip-label">TDS</div>
                    <div className="res-strip-value">{reservoirData.tds} ppm</div>
                  </div>
                  <span className="sensor-status" style={{ color: reservoirData.tds >= 500 && reservoirData.tds <= 1500 ? "#4caf50" : "#ff9800" }}>
                    {reservoirData.tds >= 500 && reservoirData.tds <= 1500 ? "✓" : "⚠"}
                  </span>
                </div>
                <div className="res-strip-item">
                  <span className="res-strip-icon">🌊</span>
                  <div>
                    <div className="res-strip-label">Turbidity</div>
                    <div className="res-strip-value">{reservoirData.turbidity} NTU</div>
                  </div>
                  <span className="sensor-status" style={{ color: reservoirData.turbidity < 50 ? "#4caf50" : "#ff9800" }}>
                    {reservoirData.turbidity < 50 ? "✓" : "⚠"}
                  </span>
                </div>
                <div className={`res-strip-item water-level-item ${reservoirData.waterLevelTriggered ? "water-level-danger" : "water-level-ok"}`}>
                  <span className="res-strip-icon">{reservoirData.waterLevelTriggered ? "🚨" : "💧"}</span>
                  <div>
                    <div className="res-strip-label">Water Level</div>
                    <div className="res-strip-value">{reservoirData.waterLevelTriggered ? "LOW — REFILL NOW" : "Optimal"}</div>
                  </div>
                  <span className="sensor-status" style={{ color: reservoirData.waterLevelTriggered ? "#f44336" : "#4caf50" }}>
                    {reservoirData.waterLevelTriggered ? "🚨" : "✓"}
                  </span>
                </div>
                <div className="res-strip-item">
                  <span className="res-strip-icon">{reservoirData.motorRunning ? "⚙️" : "⏸"}</span>
                  <div>
                    <div className="res-strip-label">Pump Motor</div>
                    <div className="res-strip-value">{reservoirData.motorState}</div>
                  </div>
                  <span className="sensor-status" style={{ color: reservoirData.motorRunning ? "#4caf50" : "#888" }}>
                    {reservoirData.motorRunning ? "✓" : "–"}
                  </span>
                </div>
                <div className="res-strip-item" style={{ gridColumn: '1 / -1', justifyContent: 'center', paddingTop: '4px' }}>
                  <button
                    onClick={triggerMotor}
                    disabled={motorTriggering || reservoirData.motorRunning}
                    style={{
                      padding: '8px 20px',
                      background: motorTriggering || reservoirData.motorRunning ? '#555' : '#1976d2',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 'bold',
                      cursor: motorTriggering || reservoirData.motorRunning ? 'not-allowed' : 'pointer',
                      opacity: motorTriggering || reservoirData.motorRunning ? 0.6 : 1,
                      transition: 'background 0.2s',
                    }}
                  >
                    {motorTriggering ? '⏳ Command sent…' : reservoirData.motorRunning ? '⚙️ Motor Running…' : '▶ Run Motor (15s)'}
                  </button>
                </div>
              </div>
            </section>

            <section className="aflc-section">
              <div className="section-header"><h3>AFLC Status</h3><span className="badge">Adaptive Fuzzy Logic</span></div>
              <div className="aflc-grid">
                <div className="aflc-card">
                  <div className="aflc-header">
                    <h4>Node 1 - AFLC Decision</h4>
                    <span className={`aflc-badge ${aflcNode1.decision.toLowerCase()}`}>{aflcNode1.decision}</span>
                  </div>
                  <div className="aflc-body">
                    <div className="aflc-confidence">
                      <span className="confidence-label">Confidence:</span>
                      <span className="confidence-value">{aflcNode1.confidence}%</span>
                    </div>
                    <div className="aflc-reason"><span className="reason-icon">💡</span><span>{aflcNode1.reason}</span></div>
                    <div className="aflc-metrics">
                      <div className="metric-item">
                        <span>CO₂: {nodeData.node1.co2} ppm</span>
                        <span className={nodeData.node1.co2 >= 400 && nodeData.node1.co2 <= 1200 ? "status-ok" : "status-warn"}>
                          {nodeData.node1.co2 >= 400 && nodeData.node1.co2 <= 1200 ? "✓" : "⚠"}
                        </span>
                      </div>
                      <div className="metric-item">
                        <span>Temp: {nodeData.node1.temperature}°C</span>
                        <span className={nodeData.node1.temperature >= 22 && nodeData.node1.temperature <= 26 ? "status-ok" : "status-warn"}>
                          {nodeData.node1.temperature >= 22 && nodeData.node1.temperature <= 26 ? "✓" : "⚠"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="aflc-card">
                  <div className="aflc-header">
                    <h4>Node 2 - AFLC Decision</h4>
                    <span className={`aflc-badge ${aflcNode2.decision.toLowerCase()}`}>{aflcNode2.decision}</span>
                  </div>
                  <div className="aflc-body">
                    <div className="aflc-confidence">
                      <span className="confidence-label">Confidence:</span>
                      <span className="confidence-value">{aflcNode2.confidence}%</span>
                    </div>
                    <div className="aflc-reason"><span className="reason-icon">💡</span><span>{aflcNode2.reason}</span></div>
                    <div className="aflc-metrics">
                      <div className="metric-item">
                        <span>CO₂: {nodeData.node2.co2} ppm</span>
                        <span className={nodeData.node2.co2 >= 400 && nodeData.node2.co2 <= 1200 ? "status-ok" : "status-warn"}>
                          {nodeData.node2.co2 >= 400 && nodeData.node2.co2 <= 1200 ? "✓" : "⚠"}
                        </span>
                      </div>
                      <div className="metric-item">
                        <span>Temp: {nodeData.node2.temperature}°C</span>
                        <span className={nodeData.node2.temperature >= 22 && nodeData.node2.temperature <= 26 ? "status-ok" : "status-warn"}>
                          {nodeData.node2.temperature >= 22 && nodeData.node2.temperature <= 26 ? "✓" : "⚠"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="charts-grid">
              <div className="card big-card">
                <div className="card-top">
                  <div><h3>Temperature by Node</h3><div className="muted tiny">Current readings</div></div>
                </div>
                <AnimatedBarChart data={temperatureChart} theme={theme} />
              </div>
              <div className="card big-card">
                <div className="card-top">
                  <div><h3>Humidity by Node</h3><div className="muted tiny">Current readings</div></div>
                </div>
                <AnimatedBarChart data={humidityChart} theme={theme} />
              </div>
              <div className="card big-card">
                <div className="card-top">
                  <div><h3>CO₂ by Node</h3><div className="muted tiny">Sensirion readings (ppm)</div></div>
                </div>
                <AnimatedBarChart data={co2Chart} theme={theme} />
              </div>
              <div className="card big-card">
                <div className="card-top">
                  <div><h3>Light (Lux) by Node</h3><div className="muted tiny">BH1750 readings</div></div>
                </div>
                <AnimatedBarChart data={luxChart} theme={theme} />
              </div>
            </section>

            <section className="charts-grid">
              <div className="card big-card">
                <div className="card-top">
                  <div><h3>Node 1 Status</h3><div className="muted tiny">All sensors</div></div>
                </div>
                <div className="node-summary">
                  <div className="summary-item"><span>🌡️ Temperature:</span><strong>{nodeData.node1.temperature}°C</strong></div>
                  <div className="summary-item"><span>💧 Humidity:</span><strong>{nodeData.node1.humidity}%</strong></div>
                  <div className="summary-item"><span>🫧 CO₂:</span><strong>{nodeData.node1.co2} ppm</strong></div>
                  <div className="summary-item"><span>☀️ Light:</span><strong>{Math.round(nodeData.node1.lux)} lx</strong></div>
                </div>
              </div>
              <div className="card big-card">
                <div className="card-top">
                  <div><h3>Node 2 Status</h3><div className="muted tiny">All sensors</div></div>
                </div>
                <div className="node-summary">
                  <div className="summary-item"><span>🌡️ Temperature:</span><strong>{nodeData.node2.temperature}°C</strong></div>
                  <div className="summary-item"><span>💧 Humidity:</span><strong>{nodeData.node2.humidity}%</strong></div>
                  <div className="summary-item"><span>🫧 CO₂:</span><strong>{nodeData.node2.co2} ppm</strong></div>
                  <div className="summary-item"><span>☀️ Light:</span><strong>{Math.round(nodeData.node2.lux)} lx</strong></div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* ── SENSORS ── */}
        {activePage === "Sensors" && (
          <section className="sensors">
            <div className="section-header"><h3>Sensor Readings</h3><span className="badge">Live Data</span></div>

            {/* ── Node 1 sensors ── */}
            <div className="sensor-group-label">📡 Node 1 — Layer 1</div>
            <div className="sensor-grid">
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Node 1 - Temperature</h4>
                  <button className="btn-edit" onClick={() => setEditingSensor({ node: "node1", key: "temperature", name: "Temperature (Node 1)", value: nodeData.node1.temperature, unit: "°C", min: 15, max: 35, step: 0.1 })}>✏️</button>
                </div>
                <div className="sensor-value">{nodeData.node1.temperature}°C</div>
                <div className="sensor-status" style={{ color: nodeData.node1.temperature >= 22 && nodeData.node1.temperature <= 26 ? "#4caf50" : "#ff9800" }}>
                  {nodeData.node1.temperature >= 22 && nodeData.node1.temperature <= 26 ? "✓ Optimal" : "⚠ Check Range"}
                </div>
              </div>
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Node 1 - Humidity</h4>
                  <button className="btn-edit" onClick={() => setEditingSensor({ node: "node1", key: "humidity", name: "Humidity (Node 1)", value: nodeData.node1.humidity, unit: "%", min: 40, max: 90, step: 1 })}>✏️</button>
                </div>
                <div className="sensor-value">{nodeData.node1.humidity}%</div>
                <div className="sensor-status" style={{ color: nodeData.node1.humidity >= 60 && nodeData.node1.humidity <= 75 ? "#4caf50" : "#ff9800" }}>
                  {nodeData.node1.humidity >= 60 && nodeData.node1.humidity <= 75 ? "✓ Optimal" : "⚠ Check Range"}
                </div>
              </div>
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Node 1 - CO₂</h4>
                  <button className="btn-edit" onClick={() => setEditingSensor({ node: "node1", key: "co2", name: "CO₂ (Node 1)", value: nodeData.node1.co2, unit: " ppm", min: 300, max: 3000, step: 10 })}>✏️</button>
                </div>
                <div className="sensor-value">{nodeData.node1.co2} ppm</div>
                <div className="sensor-meta muted tiny">Sensirion SCD4x</div>
                <div className="sensor-status" style={{ color: nodeData.node1.co2 >= 400 && nodeData.node1.co2 <= 1200 ? "#4caf50" : "#ff9800" }}>
                  {nodeData.node1.co2 >= 400 && nodeData.node1.co2 <= 1200 ? "✓ Optimal" : "⚠ Check Range"}
                </div>
              </div>
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Node 1 - Light</h4>
                </div>
                <div className="sensor-value">{Math.round(nodeData.node1.lux)} lx</div>
                <div className="sensor-status" style={{ color: nodeData.node1.lux >= 5000 && nodeData.node1.lux <= 80000 ? "#4caf50" : "#ff9800" }}>
                  {nodeData.node1.lux >= 5000 && nodeData.node1.lux <= 80000 ? "✓ Optimal" : "⚠ Check Range"}
                </div>
              </div>
            </div>

            {/* ── Node 2 sensors ── */}
            <div className="sensor-group-label" style={{ marginTop: 24 }}>📡 Node 2 — Layer 2</div>
            <div className="sensor-grid">
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Node 2 - Temperature</h4>
                  <button className="btn-edit" onClick={() => setEditingSensor({ node: "node2", key: "temperature", name: "Temperature (Node 2)", value: nodeData.node2.temperature, unit: "°C", min: 15, max: 35, step: 0.1 })}>✏️</button>
                </div>
                <div className="sensor-value">{nodeData.node2.temperature}°C</div>
                <div className="sensor-status" style={{ color: nodeData.node2.temperature >= 22 && nodeData.node2.temperature <= 26 ? "#4caf50" : "#ff9800" }}>
                  {nodeData.node2.temperature >= 22 && nodeData.node2.temperature <= 26 ? "✓ Optimal" : "⚠ Check Range"}
                </div>
              </div>
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Node 2 - Humidity</h4>
                  <button className="btn-edit" onClick={() => setEditingSensor({ node: "node2", key: "humidity", name: "Humidity (Node 2)", value: nodeData.node2.humidity, unit: "%", min: 40, max: 90, step: 1 })}>✏️</button>
                </div>
                <div className="sensor-value">{nodeData.node2.humidity}%</div>
                <div className="sensor-status" style={{ color: nodeData.node2.humidity >= 60 && nodeData.node2.humidity <= 75 ? "#4caf50" : "#ff9800" }}>
                  {nodeData.node2.humidity >= 60 && nodeData.node2.humidity <= 75 ? "✓ Optimal" : "⚠ Check Range"}
                </div>
              </div>
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Node 2 - CO₂</h4>
                  <button className="btn-edit" onClick={() => setEditingSensor({ node: "node2", key: "co2", name: "CO₂ (Node 2)", value: nodeData.node2.co2, unit: " ppm", min: 300, max: 3000, step: 10 })}>✏️</button>
                </div>
                <div className="sensor-value">{nodeData.node2.co2} ppm</div>
                <div className="sensor-meta muted tiny">Sensirion SCD4x</div>
                <div className="sensor-status" style={{ color: nodeData.node2.co2 >= 400 && nodeData.node2.co2 <= 1200 ? "#4caf50" : "#ff9800" }}>
                  {nodeData.node2.co2 >= 400 && nodeData.node2.co2 <= 1200 ? "✓ Optimal" : "⚠ Check Range"}
                </div>
              </div>
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Node 2 - Light</h4>
                </div>
                <div className="sensor-value">{Math.round(nodeData.node2.lux)} lx</div>
                <div className="sensor-status" style={{ color: nodeData.node2.lux >= 5000 && nodeData.node2.lux <= 80000 ? "#4caf50" : "#ff9800" }}>
                  {nodeData.node2.lux >= 5000 && nodeData.node2.lux <= 80000 ? "✓ Optimal" : "⚠ Check Range"}
                </div>
              </div>
            </div>

            {/* ── Reservoir sensors (universal) ── */}
            <div className="sensor-group-label reservoir-group-label" style={{ marginTop: 28 }}>
              🧪 Reservoir — Universal Sensor
              {reservoirData.waterLevelTriggered && (
                <span className="reservoir-alert-pill">🚨 WATER LEVEL LOW</span>
              )}
            </div>
            <div className="sensor-grid">
              {/* Water pH */}
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Water pH</h4>
                </div>
                <div className="sensor-value">{reservoirData.waterPH}</div>
                <div className="sensor-meta muted tiny">Atlas Scientific EZO-pH</div>
                <div className="sensor-status" style={{ color: reservoirData.waterPH >= 5.5 && reservoirData.waterPH <= 7.0 ? "#4caf50" : "#ff9800" }}>
                  {reservoirData.waterPH >= 5.5 && reservoirData.waterPH <= 7.0 ? "✓ Optimal (5.5–7.0)" : "⚠ Out of Range"}
                </div>
              </div>

              {/* TDS */}
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>TDS Sensor</h4>
                </div>
                <div className="sensor-value">{reservoirData.tds} ppm</div>
                <div className="sensor-meta muted tiny">Total Dissolved Solids</div>
                <div className="sensor-status" style={{ color: reservoirData.tds >= 500 && reservoirData.tds <= 1500 ? "#4caf50" : "#ff9800" }}>
                  {reservoirData.tds >= 500 && reservoirData.tds <= 1500 ? "✓ Optimal (500–1500 ppm)" : "⚠ Out of Range"}
                </div>
              </div>

              {/* Turbidity */}
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Turbidity Sensor</h4>
                </div>
                <div className="sensor-value">{reservoirData.turbidity} NTU</div>
                <div className="sensor-meta muted tiny">Water clarity index</div>
                <div className="sensor-status" style={{ color: reservoirData.turbidity < 50 ? "#4caf50" : "#ff9800" }}>
                  {reservoirData.turbidity < 50 ? "✓ Clear (&lt;50 NTU)" : "⚠ Turbid — Check Water"}
                </div>
              </div>

              {/* Water Level */}
              <div className={`sensor-card ${reservoirData.waterLevelTriggered ? "sensor-card-danger" : ""}`}>
                <div className="sensor-header">
                  <h4>Water Level</h4>
                </div>
                <div className={`sensor-value ${reservoirData.waterLevelTriggered ? "sensor-value-danger" : ""}`}>
                  {reservoirData.waterLevelTriggered ? "LOW ⚠" : "Optimal"}
                </div>
                <div className="sensor-meta muted tiny">Float switch sensor</div>
                <div className="sensor-status" style={{ color: reservoirData.waterLevelTriggered ? "#f44336" : "#4caf50", fontWeight: reservoirData.waterLevelTriggered ? 700 : 400 }}>
                  {reservoirData.waterLevelTriggered
                    ? "🚨 TRIGGERED — Refill reservoir immediately!"
                    : "✓ Water level is sufficient"}
                </div>
              </div>

              {/* Pump Motor */}
              <div className="sensor-card">
                <div className="sensor-header">
                  <h4>Pump Motor</h4>
                </div>
                <div className="sensor-value" style={{ color: reservoirData.motorRunning ? "#4caf50" : "#888" }}>
                  {reservoirData.motorState}
                </div>
                <div className="sensor-meta muted tiny">Stepper — 10s run / 30s stop cycle</div>
                <div className="sensor-status" style={{ color: reservoirData.motorRunning ? "#4caf50" : "#888" }}>
                  {reservoirData.motorRunning ? "⚙️ Motor is pumping" : "⏸ Motor idle"}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── NODES ── */}
        {activePage === "Nodes" && (
          <section className="nodes">
            <div className="section-header"><h3>Node Control & Irrigation</h3><span className="badge">2 Active</span></div>
            <div className="node-cards">
              <div className="node-detail-card">
                <div className="node-detail-header">
                  <h3>📡 Node 1 (Layer 1)</h3>
                  <span className="node-status-badge active">Active</span>
                </div>
                <div className="node-detail-body">
                  <div className="detail-row"><span className="detail-label">🌡️ Temperature:</span><span className="detail-value">{nodeData.node1.temperature}°C</span></div>
                  <div className="detail-row"><span className="detail-label">💧 Humidity:</span><span className="detail-value">{nodeData.node1.humidity}%</span></div>
                  <div className="detail-row"><span className="detail-label">🫧 CO₂:</span><span className="detail-value">{nodeData.node1.co2} ppm</span></div>
                  <div className="detail-row"><span className="detail-label">☀️ Light:</span><span className="detail-value">{Math.round(nodeData.node1.lux)} lx</span></div>
                  <div className="irrigation-control">
                    <div className="irrigation-status"><span className="irrigation-label">Last Irrigation:</span><span className="irrigation-time">{nodeData.node1.lastIrrigation}</span></div>
                    <div className="irrigation-status"><span className="irrigation-label">Status:</span>
                      <span className={`irrigation-badge ${nodeData.node1.irrigationStatus}`}>{nodeData.node1.irrigationStatus === "active" ? "💧 Irrigating..." : "✓ Idle"}</span>
                    </div>
                    <button className="btn-irrigate" onClick={() => manualIrrigate("node1")} disabled={nodeData.node1.irrigationStatus === "active"}>💧 Manual Irrigate</button>
                  </div>
                </div>
              </div>

              <div className="node-detail-card">
                <div className="node-detail-header">
                  <h3>📡 Node 2 (Layer 2)</h3>
                  <span className="node-status-badge active">Active</span>
                </div>
                <div className="node-detail-body">
                  <div className="detail-row"><span className="detail-label">🌡️ Temperature:</span><span className="detail-value">{nodeData.node2.temperature}°C</span></div>
                  <div className="detail-row"><span className="detail-label">💧 Humidity:</span><span className="detail-value">{nodeData.node2.humidity}%</span></div>
                  <div className="detail-row"><span className="detail-label">🫧 CO₂:</span><span className="detail-value">{nodeData.node2.co2} ppm</span></div>
                  <div className="detail-row"><span className="detail-label">☀️ Light:</span><span className="detail-value">{Math.round(nodeData.node2.lux)} lx</span></div>
                  <div className="irrigation-control">
                    <div className="irrigation-status"><span className="irrigation-label">Last Irrigation:</span><span className="irrigation-time">{nodeData.node2.lastIrrigation}</span></div>
                    <div className="irrigation-status"><span className="irrigation-label">Status:</span>
                      <span className={`irrigation-badge ${nodeData.node2.irrigationStatus}`}>{nodeData.node2.irrigationStatus === "active" ? "💧 Irrigating..." : "✓ Idle"}</span>
                    </div>
                    <button className="btn-irrigate" onClick={() => manualIrrigate("node2")} disabled={nodeData.node2.irrigationStatus === "active"}>💧 Manual Irrigate</button>
                  </div>
                </div>
              </div>

              <div className="node-detail-card waiting">
                <div className="node-detail-header">
                  <h3>📡 Node 3 (Layer 3)</h3>
                  <span className="node-status-badge waiting">Waiting</span>
                </div>
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
        {activePage === "Settings" && (
          <section className="settings">
            <h3>System Settings</h3>
            <div className="settings-grid">
              <div className="setting-card">
                <div className="setting-header"><span className="setting-icon">🎨</span><h4>Appearance</h4></div>
                <div className="setting-item">
                  <label>Theme</label>
                  <div className="toggle">
                    <button className={`btn ${theme === "light" ? "active" : ""}`} onClick={() => setTheme("light")}>☀️ Light</button>
                    <button className={`btn ${theme === "dark" ? "active" : ""}`} onClick={() => setTheme("dark")}>🌙 Dark</button>
                  </div>
                </div>
              </div>

              <div className="setting-card">
                <div className="setting-header"><span className="setting-icon">🔔</span><h4>Alerts</h4></div>
                <div className="setting-item"><label>Temperature alerts</label><input type="checkbox" defaultChecked className="toggle-switch" /></div>
                <div className="setting-item"><label>CO₂ alerts</label><input type="checkbox" defaultChecked className="toggle-switch" /></div>
                <div className="setting-item"><label>Water level alerts</label><input type="checkbox" defaultChecked className="toggle-switch" /></div>
                <div className="setting-item"><label>AFLC notifications</label><input type="checkbox" defaultChecked className="toggle-switch" /></div>
              </div>

              <div className="setting-card">
                <div className="setting-header"><span className="setting-icon">ℹ️</span><h4>About</h4></div>
                <div className="about-content">
                  <p><strong>VertiFarmVision v1.0</strong></p>
                  <p className="muted tiny">Vertical Farm Monitoring System</p>
                  <p className="muted tiny">with Adaptive Fuzzy Logic Controller</p>
                  <p className="muted tiny">Colegio de Muntinlupa</p>
                  <button className="btn ghost" style={{ marginTop: 14, width: "100%", fontSize: 13 }} onClick={logout}>🚪 Logout</button>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
