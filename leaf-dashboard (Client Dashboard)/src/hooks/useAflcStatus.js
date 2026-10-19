import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/client";

/**
 * Polls GET /api/aflc/status (the scheduler heartbeat in server.js).
 *
 * Returns:
 *   status    – last good payload (or null before the first response)
 *   offline   – true when the backend can't be reached at all
 *   offset    – serverNow - clientNow in ms, so countdowns use the SERVER's clock
 *   runNow()  – asks the server to run one AFLC cycle immediately
 *   runBusy   – a manual run is in flight
 */
export function useAflcStatus(pollMs = 4000) {
  const [status, setStatus] = useState(null);
  const [offline, setOffline] = useState(false);
  const [offset, setOffset] = useState(0);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/aflc/status");
      if (!alive.current) return;
      setStatus(data);
      setOffset(data.serverNow - Date.now());
      setOffline(false);
    } catch {
      if (alive.current) setOffline(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const id = setInterval(load, pollMs);
    return () => { alive.current = false; clearInterval(id); };
  }, [load, pollMs]);

  const runNow = useCallback(async () => {
    setRunBusy(true);
    setRunError(null);
    try {
      // Poll faster while the cycle runs so "thinking" shows up on screen.
      const fast = setInterval(load, 700);
      try { await api.post("/aflc/run-now"); } finally { clearInterval(fast); }
    } catch (err) {
      setRunError(err.response?.data?.message || err.message);
    } finally {
      await load();
      if (alive.current) setRunBusy(false);
    }
  }, [load]);

  return { status, offline, offset, runNow, runBusy, runError };
}
