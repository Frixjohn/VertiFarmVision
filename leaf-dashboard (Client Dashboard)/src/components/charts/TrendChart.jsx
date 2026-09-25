import React, { useMemo, useState } from "react";
import { METRICS, formatValue, getStatus } from "../../config/thresholds";
import { useElementSize } from "../../hooks/useDashboardHooks";

const M = { top: 12, right: 14, bottom: 26, left: 44 };
const GAP_MS = 90 * 1000; // break the line if readings stop for > 90 s

function niceStep(range, count) {
  const raw = range / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
}

function niceDomain(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks, step };
}

const tickText = (v, step) => {
  if (Math.abs(v) >= 10000) return `${+(v / 1000).toFixed(1)}k`;
  const decimals = step < 1 ? 1 : 0;
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

function Marker({ x, y, shape, color, r = 4.5 }) {
  const common = { fill: color, stroke: "var(--surface)", strokeWidth: 2 };
  return shape === "diamond"
    ? <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx="1.5" transform={`rotate(45 ${x} ${y})`} {...common} />
    : <circle cx={x} cy={y} r={r} {...common} />;
}

/**
 * Multi-series live trend chart with the metric's optimal range shaded.
 *   points  – [{ t, node1: {...}, node2: {...} }]
 *   series  – [{ key, label, color, marker, get: (point) => number|undefined }]
 */
export default function TrendChart({ metric, points, series, rangeMs = Infinity, height: fixedHeight = 220, fill = false }) {
  const meta = METRICS[metric];
  const [wrapRef, size] = useElementSize(520, 240);
  const width = size.width;
  // `fill` = take whatever height the parent gives us (used by the one-screen Overview)
  const height = fill ? Math.max(size.height, 150) : fixedHeight;
  const [hover, setHover] = useState(null);

  const view = useMemo(() => {
    if (!points.length) return null;
    const tMaxRaw = points[points.length - 1].t;
    const tMinRaw = Number.isFinite(rangeMs) ? tMaxRaw - rangeMs : points[0].t;
    const visible = points.filter((p) => p.t >= tMinRaw);
    if (!visible.length) return null;

    const tMax = visible[visible.length - 1].t;
    let tMin = Math.max(visible[0].t, tMinRaw);
    if (tMax === tMin) tMin = tMax - 60 * 1000;

    const vals = [];
    visible.forEach((p) => series.forEach((s) => { const v = s.get(p); if (Number.isFinite(v)) vals.push(v); }));
    const [bandLo, bandHi] = meta.optimal;
    const dMin = Math.min(...vals, bandLo);
    const dMax = Math.max(...vals, bandHi);
    const pad = (dMax - dMin || 1) * 0.06;
    const dom = niceDomain(dMin - pad, dMax + pad, 4);
    return { visible, tMin, tMax, dom };
  }, [points, series, rangeMs, meta]);

  if (!view) {
    return (
      <div className={`trend-empty ${fill ? "fill" : ""}`} ref={wrapRef} style={fill ? undefined : { height }}>
        <span>Waiting for the first readings…</span>
      </div>
    );
  }

  const { visible, tMin, tMax, dom } = view;
  const W = Math.max(width, 260);
  const iw = W - M.left - M.right;
  const ih = height - M.top - M.bottom;
  const x = (t) => M.left + ((t - tMin) / (tMax - tMin)) * iw;
  const y = (v) => M.top + (1 - (v - dom.lo) / (dom.hi - dom.lo)) * ih;

  const spanMs = tMax - tMin;
  const timeFmt = spanMs < 5 * 60 * 1000
    ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" };
  const fmtTime = (t, opts = timeFmt) => new Date(t).toLocaleTimeString([], opts);
  const xTickCount = Math.max(2, Math.min(6, Math.floor(iw / 96)));
  const xTicks = Array.from({ length: xTickCount }, (_, i) => tMin + (spanMs * i) / (xTickCount - 1));

  // Build line segments, splitting on gaps / missing values.
  const paths = series.map((s) => {
    const segs = [];
    let cur = [];
    let prevT = null;
    visible.forEach((p) => {
      const v = s.get(p);
      if (!Number.isFinite(v)) { if (cur.length) segs.push(cur); cur = []; prevT = null; return; }
      if (prevT !== null && p.t - prevT > GAP_MS) { segs.push(cur); cur = []; }
      cur.push([x(p.t), y(v)]);
      prevT = p.t;
    });
    if (cur.length) segs.push(cur);
    return segs;
  });

  const [bandLo, bandHi] = meta.optimal;
  const bandTop = y(Math.min(bandHi, dom.hi));
  const bandBottom = y(Math.max(bandLo, dom.lo));

  const setHoverFromEvent = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = tMin + ((px - M.left) / iw) * spanMs;
    let best = 0;
    for (let i = 1; i < visible.length; i++) {
      if (Math.abs(visible[i].t - t) < Math.abs(visible[best].t - t)) best = i;
    }
    setHover(best);
  };

  const onKeyDown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => {
      const cur = h ?? visible.length - 1;
      return Math.max(0, Math.min(visible.length - 1, cur + (e.key === "ArrowLeft" ? -1 : 1)));
    });
  };

  const hp = hover !== null ? visible[Math.min(hover, visible.length - 1)] : null;
  const hx = hp ? x(hp.t) : 0;
  const tipLeft = hp && hx > W * 0.6;

  const last = visible[visible.length - 1];
  const summary = series
    .map((s) => `${s.label} ${formatValue(metric, s.get(last))}`)
    .join(", ");

  return (
    <div className={`trend ${fill ? "fill" : ""}`} ref={wrapRef}>
      <svg
        width={W}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`${meta.label} trend. Latest: ${summary}. Optimal range ${bandLo} to ${bandHi} ${meta.unit}. Use left and right arrow keys to inspect readings.`}
        onPointerMove={setHoverFromEvent}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
      >
        {/* optimal band */}
        <rect className="trend-band" x={M.left} y={bandTop} width={iw} height={Math.max(0, bandBottom - bandTop)} />
        {[bandHi, bandLo].map((edge, i) =>
          edge > dom.lo && edge < dom.hi ? (
            <line key={i} className="trend-band-edge" x1={M.left} x2={M.left + iw} y1={y(edge)} y2={y(edge)} />
          ) : null
        )}
        {bandBottom - bandTop > 16 && (
          <text className="trend-band-label" x={M.left + 8} y={bandTop + 13}>OPTIMAL</text>
        )}

        {/* grid + y axis */}
        {dom.ticks.map((tv) => (
          <g key={tv}>
            <line className="trend-grid" x1={M.left} x2={M.left + iw} y1={y(tv)} y2={y(tv)} />
            <text className="trend-tick" x={M.left - 8} y={y(tv) + 4} textAnchor="end">{tickText(tv, dom.step)}</text>
          </g>
        ))}

        {/* x axis */}
        {xTicks.map((t, i) => (
          <text key={i} className="trend-tick" x={x(t)} y={height - 7}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>
            {fmtTime(t)}
          </text>
        ))}

        {/* series */}
        {series.map((s, si) => (
          <g key={s.key} style={{ color: s.color }}>
            {paths[si].map((seg, i) =>
              seg.length > 1 ? (
                <polyline key={i} className="trend-line" points={seg.map((p) => p.join(",")).join(" ")} />
              ) : (
                <circle key={i} cx={seg[0][0]} cy={seg[0][1]} r="2.5" fill="currentColor" />
              )
            )}
          </g>
        ))}

        {/* latest value markers */}
        {series.map((s, si) => {
          const seg = paths[si][paths[si].length - 1];
          if (!seg) return null;
          const [px, py] = seg[seg.length - 1];
          return <Marker key={s.key} x={px} y={py} shape={s.marker} color={s.color} />;
        })}

        {/* hover crosshair */}
        {hp && (
          <g>
            <line className="trend-cross" x1={hx} x2={hx} y1={M.top} y2={M.top + ih} />
            {series.map((s) => {
              const v = s.get(hp);
              return Number.isFinite(v) ? <Marker key={s.key} x={hx} y={y(v)} shape={s.marker} color={s.color} r={5} /> : null;
            })}
          </g>
        )}
      </svg>

      {hp && (
        <div className="trend-tip" style={{ left: hx, transform: `translateX(${tipLeft ? "calc(-100% - 12px)" : "12px"})`, top: M.top }}>
          <div className="trend-tip-time">{fmtTime(hp.t, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
          {series.map((s) => {
            const v = s.get(hp);
            const st = getStatus(metric, v);
            return (
              <div className="trend-tip-row" key={s.key}>
                <span className="trend-tip-dot" style={{ background: s.color }} />
                <span className="trend-tip-name">{s.label}</span>
                <strong>{formatValue(metric, v)}</strong>
                <span className={`tone-${st.tone}`}>{st.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {visible.length < 3 && (
        <p className="trend-hint">Trend builds up as new readings arrive (about every 10 s).</p>
      )}
    </div>
  );
}
