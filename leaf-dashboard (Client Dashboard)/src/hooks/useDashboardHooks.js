import { useCallback, useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Tweens a number toward its latest target, starting from whatever is
 * currently on screen (so live updates glide instead of restarting at 0).
 */
export function useAnimatedNumber(target, duration = 650) {
  const [value, setValue] = useState(0);
  const shown = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(target)) return undefined;
    if (prefersReducedMotion()) {
      shown.current = target;
      setValue(target);
      return undefined;
    }
    const from = shown.current;
    const start = performance.now();
    let raf;
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      shown.current = from + (target - from) * eased;
      setValue(shown.current);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

/** Live size of an element, for responsive SVG charts (and charts that fill their card). */
export function useElementSize(fallbackW = 480, fallbackH = 220) {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: fallbackW, height: fallbackH });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = (w, h) => {
      const width = Math.round(w) || fallbackW;
      const height = Math.round(h) || fallbackH;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    read(el.clientWidth, el.clientHeight);
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => read(entry.contentRect.width, entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallbackW, fallbackH]);

  return [ref, size];
}

/** Re-renders on an interval so "updated 12s ago" stays truthful. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function timeAgo(ts, now = Date.now()) {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const MAX_POINTS = 720; // ≈ 2 h at the 10 s poll interval

/**
 * Rolling client-side history of sensor snapshots. The API only exposes the
 * latest reading, so this is what lets charts show trends. It survives page
 * refreshes (sessionStorage) but not closing the tab.
 */
export function useHistory(storageKey) {
  const [points, setPoints] = useState(() => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const push = useCallback((sample) => {
    setPoints((prev) => {
      const t = Date.now();
      const last = prev[prev.length - 1];
      if (last && t - last.t < 3000) return prev; // ignore bursts (poll + websocket)
      const next = [...prev, { t, ...sample }];
      return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
    });
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(points)); } catch { /* quota / private mode */ }
  }, [points, storageKey]);

  return [points, push];
}

/** Close a popover on outside click or Escape. */
export function useDismiss(open, onClose, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, ref]);
}
