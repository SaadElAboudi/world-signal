import type { Observation } from "../providers/contract";
import { rollingMean } from "./baseline";
export interface MatchedBaselineOptions {
  now: Date;
  match: "hour-and-weekday" | "hour-and-day-kind";
  minSamples?: number;
  maxAgeMinutes?: number;
}
function sameSeries(a: Observation, b: Observation) {
  const aSeries = a.properties.seriesKey;
  const bSeries = b.properties.seriesKey;
  const explicitSeries =
    typeof aSeries === "string" || typeof bSeries === "string"
      ? aSeries === bSeries
      : a.properties.countryCode === b.properties.countryCode;
  return (
    a.provider === b.provider &&
    a.type === b.type &&
    a.cellId === b.cellId &&
    a.properties.metric === b.properties.metric &&
    explicitSeries &&
    a.properties.stepSeconds === b.properties.stepSeconds &&
    a.properties.snapshotSeconds === b.properties.snapshotSeconds
  );
}
export function matchedActivityBaseline(
  current: Observation,
  history: Observation[],
  options: MatchedBaselineOptions,
) {
  const date = new Date(current.timestamp),
    now = options.now.getTime();
  const unavailable = (reason: string) => ({
    available: false as const,
    reason,
    deviation: null,
    zscore: null,
    expected: null,
    confidence: 0,
    sampleCount: 0,
    referenceIds: [] as string[],
  });
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(now) ||
    date.getTime() > now ||
    now - date.getTime() > (options.maxAgeMinutes ?? 90) * 60000
  )
    return unavailable("stale_or_future_observation");
  if (
    !current.active ||
    current.value === null ||
    !Number.isFinite(current.value) ||
    current.value < 0 ||
    current.quality < 0.4 ||
    !Number.isFinite(current.quality) ||
    current.quality > 1 ||
    typeof current.properties.metric !== "string"
  )
    return unavailable("unusable_observation");
  const minSamples =
    options.minSamples ?? (options.match === "hour-and-weekday" ? 4 : 7);
  if (!Number.isInteger(minSamples) || minSamples < 4)
    throw new Error("At least four matched historical days are required");
  const weekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const days = new Map<string, Observation>();
  for (const point of history) {
    const day = new Date(point.timestamp);
    if (
      !point.active ||
      !sameSeries(current, point) ||
      point.value === null ||
      !Number.isFinite(point.value) ||
      point.value < 0 ||
      !Number.isFinite(point.quality) ||
      point.quality < 0.4 ||
      point.quality > 1 ||
      !Number.isFinite(day.getTime()) ||
      day.getTime() >= date.getTime() - 23 * 3600000 ||
      day.getTime() < date.getTime() - 35 * 86400000 ||
      day.getUTCHours() !== date.getUTCHours() ||
      Math.abs(day.getUTCMinutes() - date.getUTCMinutes()) > 15 ||
      (options.match === "hour-and-weekday"
        ? day.getUTCDay() !== date.getUTCDay()
        : weekend(day) !== weekend(date))
    )
      continue;
    const key = day.toISOString().slice(0, 10);
    const previous = days.get(key);
    // One sample per day: retries or denser sampling cannot inflate baseline N.
    if (
      !previous ||
      Math.abs(
        (Date.parse(point.timestamp) % 86400000) - (date.getTime() % 86400000),
      ) <
        Math.abs(
          (Date.parse(previous.timestamp) % 86400000) -
            (date.getTime() % 86400000),
        ) ||
      (point.timestamp === previous.timestamp && point.id < previous.id)
    )
      days.set(key, point);
  }
  const selected = [...days.values()].sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
  );
  const baseline = rollingMean.calculate(
    current.value,
    selected.map((p) => p.value!),
    minSamples,
    minSamples * 10,
  );
  if (!baseline.available || baseline.mean === null)
    return {
      ...unavailable("insufficient_matched_history"),
      sampleCount: selected.length,
      referenceIds: selected.map((p) => p.id),
    };
  return {
    available: true as const,
    reason: null,
    deviation: (current.value / baseline.mean - 1) * 100,
    zscore: baseline.zscore,
    expected: baseline.mean,
    sampleCount: selected.length,
    referenceIds: selected.map((p) => p.id),
    confidence: Math.min(
      current.type === "aviation" ? 0.55 : 0.75,
      current.quality,
      ...selected.map((p) => p.quality),
    ),
  };
}
