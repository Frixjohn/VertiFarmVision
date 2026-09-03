/**
 * api/client.js
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW REACT ↔ EXPRESS ↔ POSTGRES WORKS:
 *
 *  [React Component]
 *       │  calls api.get('/clients')
 *       ▼
 *  [axios → fetch('/api/clients')]
 *       │  Vite proxy rewrites to http://localhost:5000/api/clients
 *       ▼
 *  [Express Route: GET /api/clients]
 *       │  runs SQL query via pg Pool
 *       ▼
 *  [PostgreSQL] → returns rows → Express sends JSON → React receives data
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import axios from 'axios';

// All requests go to /api/... which Vite proxies to your Express server.
// In production, set VITE_API_URL in your .env file.
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // sends cookies (needed for auth sessions)
});

// ── Request Interceptor ──────────────────────────────────────────────────────
// Automatically attaches the JWT token (if any) to every request.
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response Interceptor ─────────────────────────────────────────────────────
// Handles 401 (token expired / not logged in) globally.
// BUT skips the redirect if this 401 came from the login endpoint itself —
// otherwise it reloads the page before the error message can even show.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/login');
    if (error.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
