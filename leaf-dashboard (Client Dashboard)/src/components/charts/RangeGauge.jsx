import React from "react";
import { METRICS, getStatus, scalePct, formatValue } from "../../config/thresholds";

/**
 * Bullet gauge: the metric's full scale, the optimal band shaded green, and a
 * marker for the current value. Answers "is it in range, and how far off?"
 */
// keep labels inside the track when a band edge sits near either end
const shift = (pct) => `translateX(${pct < 12 ? "-15%" : pct > 88 ? "-85%" : "-50%"})`;

export default function RangeGauge({ metric, value, showScale = true }) {
  const meta = METRICS[metric];
  const [lo, hi] = meta.optimal;
  const [min, max] = meta.scale;
  const status = getStatus(metric, value);
  const bandL = scalePct(metric, lo);
  const bandR = scalePct(metric, hi);
  const hasValue = Number.isFinite(value);

  return (
    <div className="gauge">
      <div className="gauge-track" role="img"
        aria-label={`${meta.label} ${formatValue(metric, value)}, ${status.label}. Optimal ${lo} to ${hi} ${meta.unit}`}>
        <div className="gauge-band" style={{ left: `${bandL}%`, width: `${bandR - bandL}%` }} />
        {hasValue && <div className={`gauge-marker state-${status.state}`} style={{ left: `${scalePct(metric, value)}%` }} />}
      </div>
      {showScale && (
        <div className="gauge-scale" aria-hidden="true">
          {lo > min && <span style={{ left: `${bandL}%`, transform: shift(bandL) }}>{lo.toLocaleString()}</span>}
          {hi < max && <span style={{ left: `${bandR}%`, transform: shift(bandR) }}>{hi.toLocaleString()}</span>}
        </div>
      )}
    </div>
  );
}
