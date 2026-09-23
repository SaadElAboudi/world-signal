import type { Observation } from "../providers/contract";
import type { WorldSignal } from "../core/types";
import { matchedActivityBaseline } from "./matched-baseline";

export function aviationDisruption(
  current: Observation,
  history: Observation[],
  now = new Date(),
): WorldSignal | null {
  const baseline = matchedActivityBaseline(current, history, {
    now,
    match: "hour-and-day-kind",
    minSamples: 7,
    maxAgeMinutes: 45,
  });
  if (
    !baseline.available ||
    baseline.expected === null ||
    baseline.deviation === null
  )
    return null;
  if (baseline.expected < 5 || baseline.deviation > -40) return null;

  const severity =
    baseline.deviation <= -80
      ? "significant"
      : baseline.deviation <= -60
        ? "elevated"
        : "notable";
  const region =
    typeof current.properties.region === "string"
      ? current.properties.region
      : "Aviation sentinel region";
  const radiusNm =
    typeof current.properties.radiusNm === "number"
      ? current.properties.radiusNm
      : 250;
  const reference = history
    .filter((point) => baseline.referenceIds.includes(point.id))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((point) => ({ timestamp: point.timestamp, value: point.value ?? 0 }));

  return {
    id: `adsblol:disruption:${String(current.properties.seriesKey ?? current.cellId)}`,
    type: "aviation",
    kind: "aviation-disruption",
    title: `Air traffic ${Math.abs(baseline.deviation).toFixed(0)}% below matched reference`,
    country: "Multiple / regional",
    region,
    latitude: current.latitude,
    longitude: current.longitude,
    timestamp: current.timestamp,
    startedAt: current.timestamp,
    updatedAt: now.toISOString(),
    sourceAsOf: current.sourceUpdatedAt,
    status: "active",
    observedValue: current.value ?? 0,
    expectedValue: baseline.expected,
    unit: `aircraft within ${radiusNm} NM`,
    deviation: baseline.deviation,
    deviationType: "percentage",
    severity,
    source: { name: "ADSB.lol · ODbL 1.0", url: current.sourceUrl },
    provenance: "observed",
    confidence: baseline.confidence,
    baseline: reference,
    baselineLabel: `${baseline.sampleCount} matched prior days · same UTC hour and weekday/weekend class`,
    description: `${current.value ?? 0} fresh airborne aircraft were observed in the ${region} sentinel radius, compared with a matched reference of ${baseline.expected.toFixed(1)}.`,
    methodology:
      "WORLD SIGNAL queries a fixed 250 NM aviation sentinel, immediately discards aircraft identifiers, and stores one 15-minute regional count. The current count is compared with one matched sample per prior day at the same UTC hour and the same weekday/weekend class. A disruption is promoted only when the reference mean is at least 5 aircraft and activity is at least 40% below reference; 60% and 80% reductions raise severity.",
    limitation:
      "This is a receiver-network sentinel, not a complete census of flights. ADS-B/MLAT coverage, aircraft equipment, API availability and the fixed sampling radius affect counts. A traffic reduction does not establish airport closure, airspace restriction, danger or cause.",
    context:
      "This signal indicates unusually low observed airborne traffic relative to comparable recent periods. Contextual evidence is required before attributing a cause.",
    evidence: {
      observationWindowHours: 0.25,
      windowStart: current.timestamp,
      windowEnd: new Date(
        Date.parse(current.timestamp) + 15 * 60_000,
      ).toISOString(),
      baselineSamples: baseline.sampleCount,
      baselineTargetSamples: 35,
      baselineWindowHours: 0.25,
      baselineStart: reference[0]?.timestamp ?? null,
      baselineEnd: reference[reference.length - 1]?.timestamp ?? null,
      ratio:
        baseline.expected > 0 ? (current.value ?? 0) / baseline.expected : null,
      zscore: baseline.zscore,
      observationCount: current.value ?? 0,
      observationIds: [current.id],
      cellId: current.cellId,
      thresholds: {
        minimumReferenceAircraft: 5,
        notableDropPercent: 40,
        elevatedDropPercent: 60,
        significantDropPercent: 80,
        minimumMatchedDays: 7,
      },
      confidenceMethod:
        "Confidence is capped at 0.55 for aviation because receiver coverage is incomplete and can vary independently of traffic. It reflects data support, not the probability or cause of a disruption.",
    },
  };
}
