import type { Severity, WorldSignal } from "../core/types";

const severityStrength: Record<Severity, number> = {
  notable: 50,
  elevated: 70,
  significant: 85,
};

function anomalyStrength(signal: WorldSignal) {
  if (signal.deviation === null) return severityStrength[signal.severity];
  const deviation = Math.abs(signal.deviation);
  if (signal.deviationType === "percentage") return Math.min(100, deviation / 0.8);
  if (signal.deviationType === "ratio") return Math.min(100, Math.max(0, deviation - 1) * 25);
  if (signal.deviationType === "zscore") return Math.min(100, deviation * 20);
  return severityStrength[signal.severity];
}

function persistenceTargetMinutes(signal: WorldSignal) {
  if (signal.kind === "earthquake-event") return 0;
  if (signal.type === "internet" || signal.type === "aviation") return 30;
  return 0;
}

/**
 * Adds a reproducible priority score to a signal without changing its source
 * evidence or claiming that a high score represents impact, danger or cause.
 */
export function assessSignal(signal: WorldSignal, now = new Date()): WorldSignal {
  const startedAt = Date.parse(signal.startedAt ?? signal.timestamp);
  const persistenceMinutes = Number.isFinite(startedAt)
    ? Math.max(0, Math.round((now.getTime() - startedAt) / 60_000))
    : 0;
  const target = persistenceTargetMinutes(signal);
  const persistence = target === 0 ? 100 : Math.min(100, (persistenceMinutes / target) * 100);
  const strength = Math.round(anomalyStrength(signal));
  const score = Math.round(
    Math.max(0, Math.min(100, strength * 0.5 + signal.confidence * 30 + persistence * 0.2)),
  );
  const storyEligible =
    signal.provenance === "observed" &&
    signal.status !== "resolved" &&
    score >= 55 &&
    persistenceMinutes >= target;
  return {
    ...signal,
    assessment: {
      score,
      anomalyStrength: strength,
      persistenceMinutes,
      storyEligible,
      methodology:
        "Priority score: 50% anomaly strength, 30% declared data quality, 20% persistence. It prioritizes investigation only; it is not an impact, danger, incident-probability or causal score.",
    },
  };
}
