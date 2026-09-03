import api from './client';

// ── AUTH ──────────────────────────────────────────────────────────────────────
export const authService = {
  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.token) localStorage.setItem('token', data.token);
    return data;
  },
  logout: async () => {
    await api.post('/auth/logout');
    localStorage.removeItem('token');
  },
  getMe: async () => {
    const { data } = await api.get('/auth/me');
    return data;
  },
};

// ── NODES ─────────────────────────────────────────────────────────────────────
export const nodeService = {
  // GET /api/nodes — returns all nodes with sensor values
  getAll: async () => {
    const { data } = await api.get('/nodes');
    return data;
  },

  // PUT /api/nodes/:id/sensors — update sensor readings for a node
  // body: { temperature, humidity, soilMoisture, soilPH }
  updateSensors: async (nodeId, sensors) => {
    const { data } = await api.put(`/nodes/${nodeId}/sensors`, sensors);
    return data;
  },

  // POST /api/nodes/:id/irrigate — trigger irrigation
  irrigate: async (nodeId, triggeredBy = 'manual') => {
    const { data } = await api.post(`/nodes/${nodeId}/irrigate`, { triggeredBy });
    return data;
  },

  // GET /api/nodes/:id/history — sensor reading history
  getHistory: async (nodeId, limit = 20) => {
    const { data } = await api.get(`/nodes/${nodeId}/history?limit=${limit}`);
    return data;
  },

  // GET /api/nodes/:id/irrigation-log
  getIrrigationLog: async (nodeId, limit = 10) => {
    const { data } = await api.get(`/nodes/${nodeId}/irrigation-log?limit=${limit}`);
    return data;
  },
};

// ── AFLC ──────────────────────────────────────────────────────────────────────
export const aflcService = {
  // POST /api/aflc/:id — log an AFLC decision
  logDecision: async (nodeId, decision) => {
    const { data } = await api.post(`/aflc/${nodeId}`, decision);
    return data;
  },
};
