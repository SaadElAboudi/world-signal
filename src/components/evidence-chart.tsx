"use client";
import { useI18n } from "@/i18n/context";
import type { WorldSignal } from "@/core/types";
export function EvidenceChart({ signal }: { signal: WorldSignal }) {
  const { t } = useI18n();
  const width = 320,
    height = 125,
    pad = 14;
  if (signal.expectedValue === null || !signal.baseline.length)
    return (
      <div className="context-note">
        <p>
          {signal.kind === "earthquake-event"
            ? t(
                "This event crossed a documented selection threshold. No historical baseline or statistical deviation is claimed.",
              )
            : t("Insufficient historical data for a baseline comparison.")}
        </p>
      </div>
    );
  const values = [...signal.baseline.map((p) => p.value), signal.observedValue];
  const max = Math.max(1, ...values) * 1.18;
  const y = (value: number) =>
    height - pad - (value / max) * (height - pad * 2);
  const points = signal.baseline
    .map(
      (p, i) =>
        `${pad + (i / Math.max(1, signal.baseline.length - 1)) * 237},${y(p.value)}`,
    )
    .join(" ");
  const synthetic = signal.provenance === "synthetic";
  return (
    <div className="evidence-chart">
      <div className="chart-key">
        <span>
          <i />
          {t("Reference samples")}
        </span>
        <span>
          <i />
          {t("Current observation")}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${signal.baseline.length} ${synthetic ? "synthetic" : "observed"} reference samples averaging ${signal.expectedValue.toFixed(2)}, compared with a current observation of ${signal.observedValue} ${signal.unit}`}
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
          y1={y(values[values.length - 2])}
          y2={y(signal.observedValue)}
          stroke="#5be0b3"
          strokeDasharray="3 3"
        />
        <circle cx="295" cy={y(signal.observedValue)} r="4" fill="#5be0b3" />
      </svg>
      <div className="chart-axis">
        <span>
          {synthetic
            ? t("−30 DAYS")
            : `${signal.baseline.length} REFERENCE WINDOWS`}
        </span>
        <span>{t("REFERENCE END")}</span>
        <span>{t("CURRENT")}</span>
      </div>
      <p className="fineprint">
        {synthetic ? "Daily" : `${signal.evidence?.baselineWindowHours}-hour`}{" "}
        {t("reference samples; dashed segment is not measured history.")}
      </p>
    </div>
  );
}
