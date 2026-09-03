# 🌿 Leaf Dashboard — Backend

Express + PostgreSQL API server.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your Postgres credentials:
   ```bash
   cp .env.example .env
   ```

3. Run the SQL in `server.js` (bottom of file) to create your tables in PostgreSQL.

4. Start the server:
   ```bash
   npm run dev   # with auto-reload (nodemon)
   npm start     # plain node
   ```

Server runs on **http://localhost:5000**

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/login | Login, returns JWT token |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Get current user |
| GET | /api/clients | List all clients |
| GET | /api/clients/:id | Get one client |
| POST | /api/clients | Create client |
| PUT | /api/clients/:id | Update client |
| DELETE | /api/clients/:id | Delete client |
| GET | /api/stats/overview | Dashboard stat cards |
| GET | /api/stats/chart | Chart data |

WebSocket available at `ws://localhost:5000`
