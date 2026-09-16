import type { DeviationType, Severity, SignalType, WorldSignal } from "./types";
export function mean(values: number[]) {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}
export function deviation(
  current: number,
  history: number[],
  type: DeviationType,
): number | null {
  if (
    !Number.isFinite(current) ||
    history.length < 7 ||
    history.some((v) => !Number.isFinite(v))
  )
    return null;
  const average = mean(history)!;
  if (type === "ratio") return average === 0 ? null : current / average;
  if (type === "percentage")
    return average === 0 ? null : ((current - average) / average) * 100;
  const variance =
    history.reduce((total, value) => total + (value - average) ** 2, 0) /
    history.length;
  return variance === 0 ? null : (current - average) / Math.sqrt(variance);
}
export const THRESHOLDS: Record<SignalType, [number, number, number]> = {
  earthquake: [1.5, 2, 3],
  wildfire: [1.5, 2, 3.5],
  internet: [10, 20, 35],
  aviation: [10, 20, 35],
};
export function classify(
  value: number | null,
  type: SignalType,
): Severity | null {
  if (value === null || !Number.isFinite(value)) return null;
  const strength =
    type === "earthquake" || type === "wildfire" ? value : Math.abs(value);
  const [notable, elevated, significant] = THRESHOLDS[type];
  return strength >= significant
    ? "significant"
    : strength >= elevated
      ? "elevated"
      : strength >= notable
        ? "notable"
        : null;
}
export function deviationLabel(signal: WorldSignal) {
  const v = signal.deviation;
  if (v === null) return "Insufficient history";
  return signal.deviationType === "ratio"
    ? `${v.toFixed(1)}×`
    : signal.deviationType === "zscore"
      ? `${v > 0 ? "+" : ""}${v.toFixed(1)}σ`
      : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;
}
export function filterSignals(
  signals: WorldSignal[],
  options: {
    types: SignalType[];
    hours: number;
    asOf: string;
    query?: string;
    significantOnly?: boolean;
    country?: string;
  },
) {
  const end = Date.parse(options.asOf),
    start = end - options.hours * 3600000;
  const query = (options.query ?? "").trim().toLowerCase();
  return signals
    .filter(
      (s) =>
        options.types.includes(s.type) &&
        Date.parse(s.timestamp) <= end &&
        Date.parse(s.timestamp) >= start &&
        (!options.significantOnly || s.severity === "significant") &&
        (!options.country || s.country === options.country) &&
        (!query ||
          `${s.country} ${s.region} ${s.title} ${s.type}`
            .toLowerCase()
            .includes(query)),
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
