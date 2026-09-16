import type { WorldSignal } from "@/core/types";
export function EvidenceChart({ signal }: { signal: WorldSignal }) {
  const width = 320,
    height = 125,
    pad = 14;
  const values = [...signal.baseline.map((p) => p.value), signal.observedValue];
  const max = Math.max(...values) * 1.18;
  const y = (value: number) =>
    height - pad - (value / max) * (height - pad * 2);
  const points = signal.baseline
    .map((p, i) => `${pad + (i / 29) * 237},${y(p.value)}`)
    .join(" ");
  return (
    <div className="evidence-chart">
      <div className="chart-key">
        <span>
          <i />
          Reference samples
        </span>
        <span>
          <i />
          Current observation
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`30 synthetic reference samples averaging ${signal.expectedValue.toFixed(0)}, compared with a current observation of ${signal.observedValue} ${signal.unit}`}
      >
        {[0.25, 0.5, 0.75].map((p) => (
          <line
            key={p}
            x1={pad}
            x2={width - pad}
            y1={y(max * p)}
            y2={y(max * p)}
            stroke="#223139"
            strokeDasharray="2 5"
          />
        ))}
        <line
          x1={pad}
          x2={width - pad}
          y1={y(signal.expectedValue)}
          y2={y(signal.expectedValue)}
          stroke="#6a8992"
          strokeDasharray="4 4"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#84acb7"
          strokeWidth="1.6"
        />
        <line
          x1="250"
          x2="295"
          y1={y(values[29])}
          y2={y(signal.observedValue)}
          stroke="#5be0b3"
          strokeDasharray="3 3"
        />
        <circle cx="295" cy={y(signal.observedValue)} r="4" fill="#5be0b3" />
      </svg>
      <div className="chart-axis">
        <span>−30 DAYS</span>
        <span>−1 DAY</span>
        <span>NOW</span>
      </div>
      <p className="fineprint">
        Daily reference samples; dashed segment is not measured history.
      </p>
    </div>
  );
}
