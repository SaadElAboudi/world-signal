import { createHash } from "node:crypto";
import type { Observation } from "../providers/contract";
import type { WorldSignal } from "../core/types";
import { matchedActivityBaseline } from "./matched-baseline";
export function activityAssessment(
  current: Observation,
  history: Observation[],
  now: Date,
) {
  const baseline = matchedActivityBaseline(current, history, {
    now,
    match: "hour-and-day-kind",
    maxAgeMinutes: current.type === "internet" ? 180 : 150,
  });
  if (
    !baseline.available ||
    baseline.expected === null ||
    baseline.deviation === null
  )
    return { eligible: false, signal: null, baseline };
  const internet = current.type === "internet";
  const deviation = baseline.deviation;
  const anomalous =
    (internet ? deviation <= -20 : Math.abs(deviation) >= 30) &&
    (baseline.zscore === null || Math.abs(baseline.zscore) >= 2);
  if (!anomalous) return { eligible: true, signal: null, baseline };
  const severity =
    Math.abs(deviation) >= (internet ? 50 : 70)
      ? "significant"
      : Math.abs(deviation) >= (internet ? 35 : 50)
        ? "elevated"
        : "notable";
  const scopeKey = String(
    internet ? current.properties.countryCode : current.cellId,
  );
  const id = `${current.provider}:activity:${createHash("sha256")
    .update(scopeKey + current.timestamp)
    .digest("hex")
    .slice(0, 24)}`;
  const references = history
    .filter((o) => baseline.referenceIds.includes(o.id))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const signal: WorldSignal = {
    id,
    scopeKey,
    providerId: current.provider,
    type: current.type,
    kind: internet ? "internet-anomaly" : "aviation-anomaly",
    title: internet
      ? "Network reachability decreased"
      : deviation < 0
        ? "Observed aviation activity decreased"
        : "Observed aviation activity increased",
    country: String(current.properties.country ?? "Offshore / unassigned"),
    region: internet
      ? "Country-level measurement"
      : `H3 regional cell ${current.cellId}`,
    latitude: current.latitude,
    longitude: current.longitude,
    timestamp: current.timestamp,
    startedAt: current.timestamp,
    updatedAt: now.toISOString(),
    sourceAsOf: current.timestamp,
    status: "detected",
    observedValue: current.value!,
    expectedValue: baseline.expected,
    unit: internet
      ? "responsive /24 network blocks"
      : "observed airborne aircraft",
    deviation,
    deviationType: "percentage",
    severity,
    source: {
      name: internet ? "IODA · active probing" : "ADSB.lol · ODbL 1.0",
      url: current.sourceUrl,
    },
    provenance: "observed",
    description: `${current.value} ${internet ? "responsive /24 network blocks" : "observed airborne aircraft"}, ${deviation.toFixed(1)}% versus ${baseline.expected.toFixed(1)} across ${baseline.sampleCount} comparable historical days.`,
    methodology: `Same UTC hour and weekday/weekend class, one sample per historical day within 35 days; minimum seven reference days and mean 10. Threshold: ${internet ? "decrease ≥20%" : "absolute change ≥30%"} and |z|≥2 when reference variance is nonzero. Missing samples are excluded, never zero-filled.`,
    limitation: internet
      ? "Active probing reflects responsiveness of monitored /24 blocks, not people online, traffic volume or an established shutdown. Coverage changes and filtering can affect measurements."
      : "Counts represent a snapshot of aircraft observed by participating receivers, not flights per hour or all aircraft in the region. Receiver outages can resemble traffic declines. Unobserved cells are unknown. Data: ADSB.lol, ODbL 1.0.",
    confidence: baseline.confidence,
    baseline: references.map((o) => ({
      timestamp: o.timestamp,
      value: o.value!,
    })),
    baselineLabel: `${baseline.sampleCount} matched historical days`,
    context:
      "A measured deviation establishes neither cause nor impact. Related measurements may help investigation; no causal inference is made.",
    evidence: {
      observationWindowHours: internet ? 1 : 0,
      windowStart: current.timestamp,
      windowEnd: internet
        ? new Date(Date.parse(current.timestamp) + 3600000).toISOString()
        : current.timestamp,
      baselineSamples: baseline.sampleCount,
      baselineTargetSamples: 20,
      baselineWindowHours: internet ? 1 : 0,
      baselineStart: references[0]?.timestamp ?? null,
      baselineEnd: references.at(-1)?.timestamp ?? null,
      ratio: current.value! / baseline.expected,
      zscore: baseline.zscore,
      observationCount: internet ? 1 : current.value!,
      observationIds: [current.id],
      cellId: current.cellId,
      thresholds: {
        minimumReferenceDays: 7,
        minimumReferenceMean: 10,
        percentage: internet ? 20 : 30,
        zscore: 2,
      },
      confidenceMethod: internet
        ? "Quality capped at 0.60: measurement-network coverage only; history, freshness and sample counts are required."
        : "Quality capped at 0.50 because receiver coverage is unknown. This is data quality, not the probability of an actual aviation disruption.",
    },
  };
  return { eligible: true, signal, baseline };
}
