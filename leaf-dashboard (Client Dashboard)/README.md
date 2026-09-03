# 🌿 Leaf Dashboard — Frontend

React + Vite dashboard. Connects to the Express backend via Vite's proxy.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. (Optional) Copy `.env.example` to `.env` — only needed for production:
   ```bash
   cp .env.example .env
   ```

3. Make sure the backend is running on port 5000, then start the frontend:
   ```bash
   npm run dev
   ```

Opens at **http://localhost:5173**

Login: `admin@leaf.com` / `password123`

## How the connection works

```
React → axios → /api/clients
             ↓
        Vite proxy (vite.config.js)
             ↓
        http://localhost:5000/api/clients  ← your Express backend
             ↓
        PostgreSQL
```

The proxy in `vite.config.js` is what connects frontend to backend — no CORS issues in dev.

## Key Files

| File | Purpose |
|------|---------|
| `src/api/client.js` | Axios instance, attaches JWT token automatically |
| `src/api/services.js` | All API functions (login, getClients, etc.) |
| `src/context/AuthContext.jsx` | Global auth state |
| `src/pages/Login.jsx` | Login page |
| `src/pages/Dashboard.jsx` | Main dashboard with live data |
| `vite.config.js` | Dev proxy → routes /api/* to Express |
