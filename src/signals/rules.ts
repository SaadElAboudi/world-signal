import type { Severity } from "../core/types";
import type { AppConfig } from "../server/config";
export function thresholdSeverity(
  value: number,
  thresholds: [number, number, number],
): Severity | null {
  if (!Number.isFinite(value)) return null;
  return value >= thresholds[2]
    ? "significant"
    : value >= thresholds[1]
      ? "elevated"
      : value >= thresholds[0]
        ? "notable"
        : null;
}
export function earthquakeSeverity(
  magnitude: number | null,
  depth: number | null,
  significance: number | null,
  config: AppConfig,
): Severity | null {
  const m = magnitude ?? -Infinity,
    sig = significance ?? -Infinity;
  if (
    m < config.quakeMinMagnitude &&
    sig < config.quakeMinSignificance &&
    !(
      m >= config.quakeShallowMagnitude &&
      depth !== null &&
      depth <= config.quakeShallowDepth
    )
  )
    return null;
  return m >= config.quakeSeverityMagnitudes[2] ||
    sig >= config.quakeSeveritySignificance[2]
    ? "significant"
    : m >= config.quakeSeverityMagnitudes[1] ||
        sig >= config.quakeSeveritySignificance[1]
      ? "elevated"
      : "notable";
}
