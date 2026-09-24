import React from "react";

/** Tiny inline trend — no axes, just direction. `values` is a plain number array. */
export default function Sparkline({ values, height = 30, tone = "brand", label }) {
  const nums = values.filter(Number.isFinite).slice(-48);
  if (nums.length < 2) return <div className="spark spark-empty" style={{ height }} aria-hidden="true" />;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const pad = (max - min || 1) * 0.15;
  const lo = min - pad;
  const hi = max + pad;
  const pts = nums.map((v, i) => [(i / (nums.length - 1)) * 100, (1 - (v - lo) / (hi - lo)) * 100]);
  const last = pts[pts.length - 1];

  return (
    <div className={`spark tone-${tone}`} style={{ height }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon className="spark-area" points={`0,100 ${pts.map((p) => p.join(",")).join(" ")} 100,100`} />
        <polyline className="spark-line" points={pts.map((p) => p.join(",")).join(" ")} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="spark-dot" style={{ left: `${last[0]}%`, top: `${last[1]}%` }} />
    </div>
  );
}
