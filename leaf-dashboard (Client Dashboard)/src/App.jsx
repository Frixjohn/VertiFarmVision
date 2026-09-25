import React, { Component, useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from "react";
import axios from "axios";
import ExportButton from "./components/ExportButton";
import Icon from "./components/Icon";
import { NotificationBell, SensorEditModal, ToastStack } from "./components/ui";
import OverviewView from "./views/OverviewView";
import AnalyticsView from "./views/AnalyticsView";
import SensorsView from "./views/SensorsView";
import NodesView from "./views/NodesView";
import SettingsView from "./views/SettingsView";
import { computeIssues } from "./config/health";
import { ENV_METRICS } from "./config/thresholds";
import { timeAgo, useHistory, useNow } from "./hooks/useDashboardHooks";

// ── Error Boundary — catches render crashes so you see an error instead of a white screen ──
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <h2>Dashboard crashed</h2>
          <pre>{String(this.state.error)}</pre>
          <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
      <Icon name="alert" size={22} className="water-alert-icon" />
      <div className="water-alert-body">
        <strong>Reservoir water level is low</strong>
        <span>The water level sensor has been triggered. Refill the reservoir now to prevent pump damage and nutrient disruption.</span>
      </div>
      <button className="btn danger-outline" onClick={onDismiss}>Acknowledge</button>
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
    <div className={`app app-centered theme-${theme}`}>
      <div className="login-card">
        <div className="login-logo-wrap">
          <img src="/images.png" alt="VertiFarmVision logo" className="brand-logo login-logo" />
        </div>
        <h2 className="login-title">VertiFarmVision</h2>
        <p className="login-sub muted">Vertical Farm Monitor — Sign in</p>

        {error && <div className="login-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-label" htmlFor="login-email">Email</label>
            <input id="login-email" type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="admin@farmdash.com" required className="login-input" />
          </div>
          <div className="login-field">
            <label className="login-label" htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="login-input" />
          </div>
          <button type="submit" disabled={loading} className="btn primary login-btn">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="muted tiny login-foot">Colegio de Muntinlupa — AFLC System</p>
      </div>
    </div>
  );
}

const NAV = [
  { name: "Overview",  icon: "dashboard", sub: "Live snapshot of the whole farm" },
  { name: "Analytics", icon: "chart",     sub: "Trends, AFLC decisions and reservoir details" },
  { name: "Sensors",  icon: "gauge",     sub: "Live readings for every sensor, with manual overrides" },
  { name: "Nodes",    icon: "radio",     sub: "Node status and irrigation control" },
  { name: "Settings", icon: "settings",  sub: "Appearance, alerts and account" },
];

const CONNECTION_LABEL = { connected: "Live", connecting: "Connecting", offline: "Offline" };

// ── Main App ──────────────────────────────────────────────────────────────────
function AppInner() {
  const [theme, setTheme] = useState(() => localStorage.getItem("farmDash-theme") || "light");
  const [textSize, setTextSize] = useState(() => localStorage.getItem("farmDash-textsize") || "normal");
  const [activePage, setActivePage] = useState("Overview");
  const [toasts, setToasts] = useState([]);
  const [notificationLog, setNotificationLog] = useState([]);
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
  const [lastUpdated, setLastUpdated] = useState(null);
  const now = useNow(1000);

  // ── Real AFLC decisions from the Python controller (via Postgres) ─────────
  // Keyed by node1/node2, shape matches aflc_service.py's response
  // (decision, confidence, reason, ecl, chs, demandPct, holdDelaySec, ...).
  const [aflcDecisions, setAflcDecisions] = useState({});

  // ── Reservoir sensor data (universal — not node-based) ────────────────────
  const [reservoirData, setReservoirData] = useState({
    waterPH: 6.2,
    tds: 850,
    turbidity: 12,
    waterLevelTriggered: false,
    motorRunning: false,
    motorState: 'STOPPED',
  });
  const [reservoirLoaded, setReservoirLoaded] = useState(false);
  const [motorTriggering, setMotorTriggering] = useState(false);
  const [cameraCapturing,  setCameraCapturing]  = useState(false);
  const [latestMLResult,   setLatestMLResult]   = useState(null);
  // latestMLResult shape: { label, confidence, probabilities, timestamp, imageData }
  const [irrigateAllStatus, setIrrigateAllStatus] = useState("idle"); // "idle" | "active"

  // ── Rolling history for the trend charts (client-side, see useHistory) ────
  const [nodeHistory, pushNodeHistory] = useHistory("farmDash-history-nodes");
  const [reservoirHistory, pushReservoirHistory] = useHistory("farmDash-history-reservoir");

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

  // useLayoutEffect (not useEffect) so this runs synchronously right after
  // React commits the DOM, before the browser paints — otherwise <html>/<body>
  // stay light for a frame on every load (they inherit --bg from :root until
  // this class lands), even though .app itself is already themed correctly.
  // That's what reads as "dark mode is broken" / a flash of light theme.
  useLayoutEffect(() => {
    localStorage.setItem("farmDash-theme", theme);
    // Apply class to <html> so CSS vars cascade to html/body/#root backgrounds
    document.documentElement.classList.toggle("theme-dark", theme === "dark");
  }, [theme]);

  useLayoutEffect(() => {
    localStorage.setItem("farmDash-textsize", textSize);
    document.documentElement.classList.toggle("text-large", textSize === "large");
  }, [textSize]);

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
      // Merge into defaults so node1/node2 are never undefined even if the
      // server returns 0 rows or the DB node names don't match the keyMap.
      setNodeData(prev => ({ ...prev, ...mapped }));
      setNodeIds(ids);
      setDbStatus("connected");
      setLastUpdated(Date.now());
    } catch {
      setDbStatus("offline");
    }
  }, []);

  // ── Load real AFLC decisions (latest per node) from Postgres ──────────────
  const loadAflc = useCallback(async (ids) => {
    const entries = Object.entries(ids);
    if (entries.length === 0) return;

    const results = await Promise.all(
      entries.map(async ([key, nodeId]) => {
        try {
          const { data } = await api.get(`/aflc/${nodeId}/latest`);
          return [key, {
            decision: data.decision,
            confidence: parseFloat(data.confidence),
            reason: data.reason,
            ecl: data.ecl,
            chs: data.chs,
            stressScore: data.stress_score !== null ? parseFloat(data.stress_score) : null,
            demandPct: data.demand_pct !== null ? parseFloat(data.demand_pct) : null,
            demandBracket: data.demand_bracket,
            holdDelaySec: data.hold_delay_sec,
            pumpDurationSec: data.pump_duration_sec,
            baseDurationSec: data.base_duration_sec,
            adaptiveGainSec: data.adaptive_gain_sec !== null ? parseFloat(data.adaptive_gain_sec) : null,
            conditionPersistedSec: data.condition_persisted_sec !== null ? parseFloat(data.condition_persisted_sec) : null,
            deviations: data.deviations,
            updatedAt: data.created_at,
          }];
        } catch {
          return [key, null]; // 404 (nothing logged yet) or request failure — skip
        }
      })
    );

    setAflcDecisions((prev) => {
      const next = { ...prev };
      results.forEach(([key, value]) => { if (value) next[key] = value; });
      return next;
    });
  }, []);


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
      setReservoirLoaded(true);
      setLastUpdated(Date.now());
    } catch {
      // Falls back to defaults silently
    }
  }, []);

  // ── Toasts ─────────────────────────────────────────────────────────────────
  const showToast = useCallback((message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setNotificationLog(prev => [
      { id, message, type, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) },
      ...prev.slice(0, 49),
    ]);
  }, []);
  const removeToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // ── Queue a motor run command — ESP32 picks it up on its next POST ─────────
  const triggerMotor = useCallback(async () => {
    setMotorTriggering(true);
    try {
      await api.post('/reservoir/motor/run');
      showToast('Motor command sent — ESP32 will run for 15 seconds.', 'success');
    } catch {
      showToast('Failed to send motor command.', 'error');
    } finally {
      // Keep button disabled for 16s (15s run + 1s buffer) so user can't spam
      setTimeout(() => setMotorTriggering(false), 16000);
    }
  }, [showToast]);

  // ── Add an image notification directly to the log (no toast popup) ─────────
  const showImageNotification = useCallback((message, imageData, capturedAt, mlResult = null) => {
    const id   = Date.now();
    const time = capturedAt
      ? new Date(capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    setNotificationLog(prev => [
      { id, message, type: 'image', time, imageData, mlResult },
      ...prev.slice(0, 49),
    ]);

    if (mlResult) {
      setLatestMLResult({ ...mlResult, imageData, capturedAt });
    }

    const toastText = mlResult
      ? mlResult.label === 'healthy'
        ? `Healthy plant detected (${mlResult.confidence}% confidence)`
        : `Disease detected (${mlResult.confidence}% confidence)`
      : 'Camera image captured';

    const toastType = mlResult?.label === 'diseased' ? 'warning' : 'success';
    showToast(toastText, toastType);
  }, [showToast]);



  // ── Queue a camera capture command — ESP32 picks it up on its next POST ─────
  const captureCamera = useCallback(async () => {
    setCameraCapturing(true);
    try {
      await api.post('/camera/capture');
      showToast('Camera command sent — waiting for ESP32…', 'success');
    } catch {
      showToast('Failed to send camera command.', 'error');
      setCameraCapturing(false);
    }
    // Button stays disabled until the WS camera_image event clears it (or 30s timeout)
    setTimeout(() => setCameraCapturing(false), 30000);
  }, [showToast]);

  useEffect(() => {
    if (!user) return;
    loadNodes();
    loadReservoir();
    const nodeInterval = setInterval(loadNodes, 10000);
    const reservoirInterval = setInterval(loadReservoir, 8000);
    return () => { clearInterval(nodeInterval); clearInterval(reservoirInterval); };
  }, [user, loadNodes, loadReservoir]);

  // ── Poll real AFLC decisions once node IDs are known ───────────────────────
  useEffect(() => {
    if (!user || Object.keys(nodeIds).length === 0) return;
    loadAflc(nodeIds);
    const aflcInterval = setInterval(() => loadAflc(nodeIds), 10000);
    return () => clearInterval(aflcInterval);
  }, [user, nodeIds, loadAflc]);

  const [uploadBusy, setUploadBusy] = useState(false);

const uploadImage = useCallback(async (file) => {
  if (!file) return;
  setUploadBusy(true);
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const { data } = await api.post('/camera/analyze', { image_base64: base64 });
    showImageNotification('Test image analyzed', `data:image/jpeg;base64,${base64}`, new Date().toISOString(), data.mlResult);
  } catch (err) {
    showToast(`Analysis failed: ${err.response?.data?.message || err.message}`, 'error');
  } finally {
    setUploadBusy(false);
  }
}, [showToast, showImageNotification]);

  // ── Water level alert: fire toast + reset banner dismiss when triggered ───
  useEffect(() => {
    if (reservoirData.waterLevelTriggered && !prevWaterLevel.current) {
      setWaterAlertDismissed(false);
      showToast("Reservoir low — water level sensor triggered. Check the reservoir immediately.", "warning");
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
        if (msg.type === "camera_image") {
          setCameraCapturing(false);
          showImageNotification(
            `Snapshot — ${msg.width}×${msg.height}px`,
            msg.imageData,
            msg.capturedAt,
            msg.mlResult ?? null,
          );
        }
      } catch {}
    };
    return () => ws.close();
  }, [user, loadNodes, loadReservoir, showImageNotification]);

  // ── Log AFLC decisions to DB on every data change ─────────────────────────
  useEffect(() => {
    if (!user || Object.keys(nodeIds).length === 0) return;
    Object.entries(nodeData).forEach(([nodeName, data]) => {
      const nodeId = nodeIds[nodeName];
      if (!nodeId) return;
      api.post(`/aflc/${nodeId}`, {
        temperature: data.temperature,
        humidity: data.humidity,
        co2: data.co2,
        light: data.lux,
      }).catch(() => {});
    });
  }, [nodeData, nodeIds, user]);


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

  // ── Irrigate all nodes — single system-wide command ───────────────────────
  const irrigateAll = useCallback(async () => {
    setIrrigateAllStatus("active");
    try {
      await api.post("/irrigate-all", { triggeredBy: "manual" });
      showToast("Irrigation command sent to all nodes and the ESP32.", "success");
    } catch (err) {
      showToast(`Irrigation failed: ${err.response?.data?.message || err.message}`, "error");
      setIrrigateAllStatus("idle");
      return;
    }
    // Auto-reset after 10 s (matches server auto-complete)
    setTimeout(() => {
      setIrrigateAllStatus("idle");
      loadNodes();
      showToast("Irrigation cycle complete.", "success");
    }, 10000);
  }, [showToast, loadNodes]);

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    localStorage.removeItem("farmDash-token");
    setUser(null);
  }, []);

  // ── Safe node accessors — guards against loadNodes returning {} ───────────
  const n1 = nodeData.node1 ?? { temperature: 24.5, humidity: 65, co2: 800, lux: 0, lastIrrigation: "Never", irrigationStatus: "idle" };
  const n2 = nodeData.node2 ?? { temperature: 23.8, humidity: 68, co2: 820, lux: 0, lastIrrigation: "Never", irrigationStatus: "idle" };
  const nodes = useMemo(() => ({ node1: n1, node2: n2 }), [n1, n2]);

  // ── Computed averages (node-based) ─────────────────────────────────────────
  const averages = useMemo(() => {
    const out = {};
    ENV_METRICS.forEach((m) => { out[m] = ((n1[m] ?? 0) + (n2[m] ?? 0)) / 2; });
    return out;
  }, [n1, n2]);

  const aflc = useMemo(() => ({
    node1: aflcDecisions.node1 ?? calculateAFLCDecision(n1),
    node2: aflcDecisions.node2 ?? calculateAFLCDecision(n2),
  }), [aflcDecisions, n1, n2]);
  const issues = useMemo(() => computeIssues(nodes, reservoirData), [nodes, reservoirData]);

  // ── Record history only from real server data (never the placeholder defaults) ──
  useEffect(() => {
    if (dbStatus !== "connected") return;
    const pick = (d) => ({ temperature: d.temperature, humidity: d.humidity, co2: d.co2, lux: d.lux });
    pushNodeHistory({ node1: pick(n1), node2: pick(n2) });
  }, [nodeData, dbStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!reservoirLoaded) return;
    pushReservoirHistory({ ph: reservoirData.waterPH, tds: reservoirData.tds, turbidity: reservoirData.turbidity });
  }, [reservoirData, reservoirLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth gates ─────────────────────────────────────────────────────────────
  if (!authChecked) {
    return (
      <div className={`app app-centered theme-${theme}`}>
        <div className="muted">Loading…</div>
      </div>
    );
  }

  if (!user) return <LoginScreen onLogin={setUser} theme={theme} />;

  const page = NAV.find((p) => p.name === activePage);
  const nodeCount = Object.keys(nodeIds).length;

  // ── Dashboard ──────────────────────────────────────────────────────────────
  return (
    <div className={`app theme-${theme}`}>
      <a className="skip-link" href="#main">Skip to content</a>

      <ToastStack toasts={toasts} onRemove={removeToast} />

      {editingSensor && (
        <SensorEditModal
          sensor={editingSensor}
          onSave={(value) => updateSensor(editingSensor.node, editingSensor.key, value)}
          onClose={() => setEditingSensor(null)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="brand">
          <img src="/images.png" alt="" className="brand-logo" />
          <div>
            <h1>VertiFarmVision</h1>
            <div className="tiny">Vertical Farm Monitor</div>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          {NAV.map((p) => (
            <button
              key={p.name}
              className={`nav-btn ${activePage === p.name ? "active" : ""}`}
              aria-current={activePage === p.name ? "page" : undefined}
              onClick={() => setActivePage(p.name)}
            >
              <Icon name={p.icon} size={18} />
              {p.name}
              {p.name === "Sensors" && reservoirData.waterLevelTriggered && (
                <span className="nav-alert-dot" title="Water level alert" aria-label="Water level alert" />
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className={`sidebar-status conn-${dbStatus}`}>
            <span className="dot" />
            <div>
              <strong>{dbStatus === "connected" ? "System active" : dbStatus === "offline" ? "Server offline" : "Connecting…"}</strong>
              <span className="tiny">{dbStatus === "connected" ? `${nodeCount || 2} nodes reporting` : "Waiting for data"}</span>
            </div>
          </div>
          {reservoirData.waterLevelTriggered && (
            <div className="sidebar-status conn-offline"><span className="dot" /><strong>Reservoir low</strong></div>
          )}
          <div className="authors">
            <div className="author-title">Developed by</div>
            <div className="author-name">Chungwee, Frixjohn Q.</div>
            <div className="author-name">Yara, Marko Karlo A.</div>
            <div className="author-name">Martizano, Arabella Mae B.</div>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className={`main ${activePage === "Overview" ? "fit" : ""}`} id="main" tabIndex={-1}>
        <header className="main-head">
          <div>
            <h2 className="page-title">{activePage}</h2>
            <p className="muted page-sub">{page.sub}</p>
          </div>
          <div className="actions">
            <span className={`conn conn-${dbStatus}`} role="status">
              <span className="dot" />
              {CONNECTION_LABEL[dbStatus]}
              {dbStatus === "connected" && lastUpdated && <span className="conn-time">· {timeAgo(lastUpdated, now)}</span>}
            </span>
            <button
              className="icon-btn"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} size={19} />
            </button>
            <ExportButton
              nodeData={nodeData}
              reservoirData={reservoirData}
              onExported={() => showToast("Data exported successfully.", "success")}
            />
            <NotificationBell log={notificationLog} onClear={() => setNotificationLog([])} />
          </div>
        </header>

        {/* ── Global Water Level Alert Banner ── */}
        {reservoirData.waterLevelTriggered && !waterAlertDismissed && (
          <WaterLevelAlert onDismiss={() => setWaterAlertDismissed(true)} />
        )}

        {activePage === "Overview" && (
          <OverviewView
            nodes={nodes}
            averages={averages}
            nodeHistory={nodeHistory}
            aflc={aflc}
            reservoir={reservoirData}
            issues={issues}
            connection={dbStatus}
            lastUpdated={lastUpdated}
            now={now}
            onRunMotor={triggerMotor}
            motorBusy={motorTriggering}
            onCapture={captureCamera}
            cameraBusy={cameraCapturing}
            onUploadImage={uploadImage}
            uploadBusy={uploadBusy}
          />
        )}

        {activePage === "Analytics" && (
          <AnalyticsView
            nodes={nodes}
            averages={averages}
            nodeHistory={nodeHistory}
            reservoirHistory={reservoirHistory}
            aflc={aflc}
            reservoir={reservoirData}
            issues={issues}
            connection={dbStatus}
            lastUpdated={lastUpdated}
            now={now}
            latestMLResult={latestMLResult}
            onRunMotor={triggerMotor}
            motorBusy={motorTriggering}
            onCapture={captureCamera}
            cameraBusy={cameraCapturing}
            onUploadImage={uploadImage}
            uploadBusy={uploadBusy}
          />
        )}

        {activePage === "Sensors" && (
          <SensorsView
            nodes={nodes}
            nodeHistory={nodeHistory}
            reservoir={reservoirData}
            reservoirHistory={reservoirHistory}
            onEdit={setEditingSensor}
          />
        )}

        {activePage === "Nodes" && (
          <NodesView nodes={nodes} aflc={aflc} irrigateAllStatus={irrigateAllStatus} onIrrigateAll={irrigateAll} />
        )}

        {activePage === "Settings" && (
          <SettingsView theme={theme} setTheme={setTheme} textSize={textSize} setTextSize={setTextSize} onLogout={logout} />
        )}
      </main>

      {/* ── Mobile tab bar (the sidebar is hidden on small screens) ── */}
      <nav className="tabbar" aria-label="Main">
        {NAV.map((p) => (
          <button key={p.name} className={activePage === p.name ? "active" : ""}
            aria-current={activePage === p.name ? "page" : undefined} onClick={() => setActivePage(p.name)}>
            <Icon name={p.icon} size={20} />
            <span>{p.name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>;
}
