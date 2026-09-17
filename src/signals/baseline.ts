export interface Coverage {
  start: number;
  end: number;
}
export function mergeCoverage(ranges: Coverage[]): Coverage[] {
  const merged: Coverage[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (
      !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) ||
      range.end < range.start
    )
      continue;
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}
export function windowCovered(
  start: number,
  end: number,
  coverage: Coverage[],
) {
  return coverage.some((r) => r.start <= start && r.end >= end);
}
export interface BaselineResult {
  available: boolean;
  mean: number | null;
  standardDeviation: number | null;
  ratio: number | null;
  zscore: number | null;
  sampleCount: number;
  total: number;
  reason: string | null;
}
export interface BaselineStrategy {
  id: string;
  calculate(
    current: number,
    history: number[],
    minSamples: number,
    minTotal: number,
  ): BaselineResult;
}
export const rollingMean: BaselineStrategy = {
  id: "rolling-mean-v1",
  calculate(current, history, minSamples, minTotal) {
    const total = history.reduce((a, b) => a + b, 0);
    const empty = {
      available: false,
      mean: null,
      standardDeviation: null,
      ratio: null,
      zscore: null,
      sampleCount: history.length,
      total,
      reason: "Insufficient historical data",
    };
    if (
      !Number.isFinite(current) ||
      current < 0 ||
      history.some((v) => !Number.isFinite(v) || v < 0) ||
      history.length < minSamples ||
      total < minTotal
    )
      return empty;
    const mean = total / history.length;
    if (mean === 0)
      return { ...empty, reason: "Zero reference mean; no finite ratio" };
    const standardDeviation = Math.sqrt(
      history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length,
    );
    return {
      available: true,
      mean,
      standardDeviation,
      ratio: current / mean,
      zscore:
        standardDeviation === 0 ? null : (current - mean) / standardDeviation,
      sampleCount: history.length,
      total,
      reason: null,
    };
  },
};
