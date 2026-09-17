import type { WorldSignal, SignalEvidence } from "../core/types";
import { rollingMean, windowCovered, type Coverage } from "./baseline";
import { dataConfidence, CONFIDENCE_METHOD } from "./confidence";
import { cellGeography, countryAt } from "./geography";
import { earthquakeSeverity, thresholdSeverity } from "./rules";
import type { AppConfig } from "../server/config";
import type { Observation } from "../providers/contract";
export interface CellAggregate {
  cell_id: string;
  bucket: number;
  count: number;
  mean_quality: number;
  frp_total: number | null;
  frp_count: number;
  first_at: string;
  last_at: string;
  ids: string[] | null;
  high: number;
  nominal: number;
  low: number;
}
export interface AnalysisContext {
  provider: "usgs" | "firms";
  end: number;
  now: number;
  sourceAsOf: string;
  coverage: Coverage[];
  config: AppConfig;
}
export function buildClusterSignals(
  rows: CellAggregate[],
  ctx: AnalysisContext,
): WorldSignal[] {
  const fire = ctx.provider === "firms";
  const hours = fire ? 24 : 6;
  const interval = hours * 3600000;
  const target = fire ? 30 : 120;
  const minWindows = fire
    ? ctx.config.fireMinWindows
    : ctx.config.quakeClusterMinWindows;
  if (!windowCovered(ctx.end - interval, ctx.end, ctx.coverage)) return [];
  const grouped = new Map<string, Map<number, CellAggregate>>();
  for (const row of rows) {
    if (!grouped.has(row.cell_id)) grouped.set(row.cell_id, new Map());
    grouped.get(row.cell_id)!.set(row.bucket, row);
  }
  const signals: WorldSignal[] = [];
  for (const [cell, buckets] of grouped) {
    const current = buckets.get(0);
    if (
      !current ||
      current.count <
        (fire ? ctx.config.fireMinCurrent : ctx.config.quakeClusterMinCount)
    )
      continue;
    const baseline: WorldSignal["baseline"] = [];
    for (let bucket = target; bucket >= 1; bucket--) {
      const end = ctx.end - bucket * interval,
        start = end - interval;
      if (windowCovered(start, end, ctx.coverage))
        baseline.push({
          timestamp: new Date(end).toISOString(),
          value: buckets.get(bucket)?.count ?? 0,
        });
    }
    const result = rollingMean.calculate(
      current.count,
      baseline.map((p) => p.value),
      minWindows,
      fire ? ctx.config.fireMinHistory : 20,
    );
    if (!result.available || result.ratio === null || result.mean === null)
      continue;
    if (!fire && (result.zscore === null || result.ratio < 2)) continue;
    const score = fire ? result.ratio : result.zscore!;
    const severity = thresholdSeverity(
      score,
      fire ? ctx.config.fireThresholds : ctx.config.quakeThresholds,
    );
    if (!severity) continue;
    const geo = cellGeography(cell);
    const sampleDescription = `${baseline.length} ${hours}-hour reference windows`;
    const evidence: SignalEvidence = {
      observationWindowHours: hours,
      windowStart: new Date(ctx.end - interval).toISOString(),
      windowEnd: new Date(ctx.end).toISOString(),
      baselineSamples: baseline.length,
      baselineTargetSamples: target,
      baselineWindowHours: hours,
      baselineStart: baseline[0]?.timestamp
        ? new Date(Date.parse(baseline[0].timestamp) - interval).toISOString()
        : null,
      baselineEnd: baseline[baseline.length - 1]?.timestamp ?? null,
      ratio: result.ratio,
      zscore: result.zscore,
      observationCount: current.count,
      observationIds: current.ids ?? [],
      cellId: cell,
      frpMw: fire ? current.frp_total : undefined,
      frpSampleCount: fire ? current.frp_count : undefined,
      confidenceDistribution: fire
        ? { high: current.high, nominal: current.nominal, low: current.low }
        : undefined,
      thresholds: {
        severity: fire ? ctx.config.fireThresholds : ctx.config.quakeThresholds,
        minCurrent: fire
          ? ctx.config.fireMinCurrent
          : ctx.config.quakeClusterMinCount,
        minHistoryWindows: minWindows,
      },
      confidenceMethod: CONFIDENCE_METHOD,
    };
    const confidence = dataConfidence({
      quality: current.mean_quality,
      currentCount: current.count,
      historySamples: baseline.length,
      targetSamples: target,
      coefficientOfVariation: (result.standardDeviation ?? 0) / result.mean,
      ageHours: Math.max(0, (ctx.now - Date.parse(ctx.sourceAsOf)) / 3600000),
      freshnessHours: fire
        ? ctx.config.firmsStaleMinutes / 60
        : ctx.config.usgsStaleMinutes / 60,
    });
    signals.push({
      id: `${ctx.provider}:cluster:${cell}`,
      type: fire ? "wildfire" : "earthquake",
      kind: fire ? "fire-cluster" : "earthquake-cluster",
      country: geo.country,
      region: `H3 cell · approximately ${Math.round(geo.areaKm2).toLocaleString("en-US")} km²`,
      latitude: geo.latitude,
      longitude: geo.longitude,
      timestamp: new Date(current.last_at).toISOString(),
      startedAt: new Date(current.first_at).toISOString(),
      updatedAt: new Date(ctx.now).toISOString(),
      sourceAsOf: ctx.sourceAsOf,
      status: "active",
      title: fire
        ? `Thermal detections ${result.ratio.toFixed(1)}× reference`
        : `Unusual seismic activity · ${current.count} events`,
      observedValue: current.count,
      expectedValue: result.mean,
      unit: fire ? "detections / 24h" : "earthquakes / 6h",
      deviation: score,
      deviationType: fire ? "ratio" : "zscore",
      severity,
      provenance: "observed",
      confidence,
      baseline,
      baselineLabel: `${sampleDescription}${baseline.length < target ? " · provisional" : ""}`,
      evidence,
      source: fire
        ? {
            name: "NASA FIRMS · NOAA-20 VIIRS",
            url: "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv",
          }
        : {
            name: "USGS earthquake catalogue",
            url: `https://earthquake.usgs.gov/earthquakes/map/?extent=${geo.latitude - 3},${geo.longitude - 3}&extent=${geo.latitude + 3},${geo.longitude + 3}`,
          },
      description: `${current.count} ${fire ? "nominal/high-confidence thermal detections" : "earthquakes of magnitude " + ctx.config.quakeClusterMagnitude + " or above"} in ${hours} hours, compared with ${result.mean.toFixed(2)} per equal-length window across ${sampleDescription}. The current window is excluded from the reference.`,
      methodology: `${fire ? "NOAA-20 VIIRS detections grouped into H3 resolution 3 cells; low-confidence pixels excluded." : "USGS earthquakes grouped into H3 resolution 2 cells; minimum magnitude " + ctx.config.quakeClusterMagnitude + "."} Count within a ${hours}-hour window. Reference: arithmetic mean and population standard deviation of covered, non-overlapping prior windows, targeting ${fire ? "30 days" : "120 six-hour windows (30 days)"}. Missing feed windows are excluded, not zero-filled. ${fire ? "Ratio = current / mean." : "Z-score = (current − mean) / standard deviation, requiring a ratio of at least 2."} Cell extent is not an incident perimeter.${fire && ctx.config.firmsRawRetentionHours > 0 ? ` Raw ${ctx.config.firmsRawSamplesPerHour ? `samples (up to ${ctx.config.firmsRawSamplesPerHour} per cell per hour)` : "detections"} are retained for ${ctx.config.firmsRawRetentionHours} hours. Counts and references use all qualified detections, aggregated hourly and retained for 35 days.` : ""}`,
      limitation: fire
        ? `Thermal detections are not individual fires or verified wildfire incidents. Clouds, overpasses, industrial heat and agricultural burning influence counts. ${baseline.length < 30 ? "Short provisional reference; a full 30-day baseline is not yet available. " : ""}No seasonal adjustment or satellite non-detection coverage correction. The current window ends ${ctx.config.firmsSettlementHours} hours behind collection time to reduce incomplete-window bias.`
        : "Catalogue completeness varies geographically and by magnitude. Aftershocks are not independent; count deviations do not predict future earthquakes or measure danger. No seasonal or reporting-coverage correction.",
      context: fire
        ? "This signal identifies an elevated count of satellite thermal detections relative to the stored reference. It does not establish the cause, affected area, damage or number of separate fires."
        : "This signal identifies an unusual count in a geographic cell. It does not establish impact, a causal mechanism or the likelihood of a future earthquake.",
    });
  }
  return signals;
}
export function individualEarthquake(
  observation: Observation,
  config: AppConfig,
  now = new Date(),
): WorldSignal | null {
  const p = observation.properties;
  const magnitude = observation.value;
  const depth = typeof p.depth === "number" ? p.depth : null;
  const significance = typeof p.sig === "number" ? p.sig : null;
  const severity = earthquakeSeverity(magnitude, depth, significance, config);
  if (!observation.active || !severity) return null;
  const confidence = p.status === "reviewed" ? 0.85 : 0.65;
  return {
    id: `usgs:event:${observation.upstreamId}`,
    type: "earthquake",
    kind: "earthquake-event",
    title:
      magnitude === null
        ? "Earthquake meets USGS significance threshold"
        : `M${magnitude.toFixed(1)} earthquake`,
    latitude: observation.latitude,
    longitude: observation.longitude,
    country: countryAt(observation.latitude, observation.longitude),
    region:
      typeof p.place === "string" ? p.place : "Location not provided by USGS",
    timestamp: observation.timestamp,
    startedAt: observation.timestamp,
    updatedAt: now.toISOString(),
    sourceAsOf: observation.sourceUpdatedAt,
    status: "active",
    observedValue: magnitude ?? significance!,
    expectedValue: null,
    unit: magnitude === null ? "USGS significance" : "magnitude",
    deviation: null,
    deviationType: "absolute",
    severity,
    source: { name: "USGS · original event", url: observation.sourceUrl },
    provenance: "observed",
    confidence,
    baseline: [],
    baselineLabel:
      "Magnitude / depth / significance threshold · no historical comparison",
    magnitude: magnitude ?? undefined,
    depth: depth ?? undefined,
    description: `USGS reports ${magnitude === null ? "an earthquake" : `a magnitude ${magnitude.toFixed(1)} earthquake`}${depth === null ? " (depth unavailable)" : ` at ${depth.toFixed(1)} km depth`}. ${p.status === "reviewed" ? "The event is reviewed by USGS." : "The event is preliminary and may be revised."}`,
    methodology: `Selected when magnitude ≥ ${config.quakeMinMagnitude}, USGS significance ≥ ${config.quakeMinSignificance}, or magnitude ≥ ${config.quakeShallowMagnitude} at depth ≤ ${config.quakeShallowDepth} km. Severity: significant for M≥${config.quakeSeverityMagnitudes[2]} or USGS significance≥${config.quakeSeveritySignificance[2]}; elevated for M≥${config.quakeSeverityMagnitudes[1]} or significance≥${config.quakeSeveritySignificance[1]}; otherwise notable. This is a configurable event-selection threshold, not a statistical anomaly or danger rating.`,
    limitation:
      "No historical baseline applies to this event threshold. Magnitude, depth and location may be revised; no impact, damage or future-event prediction is inferred.",
    context:
      "This observation crossed the documented selection threshold. Local shaking and impact require separate authoritative information.",
    evidence: {
      observationWindowHours: 0,
      windowStart: observation.timestamp,
      windowEnd: observation.timestamp,
      baselineSamples: 0,
      baselineTargetSamples: 0,
      baselineWindowHours: 0,
      baselineStart: null,
      baselineEnd: null,
      ratio: null,
      zscore: null,
      observationCount: 1,
      observationIds: [observation.id],
      thresholds: {
        magnitude: config.quakeMinMagnitude,
        significance: config.quakeMinSignificance,
        shallowMagnitude: config.quakeShallowMagnitude,
        shallowDepth: config.quakeShallowDepth,
        magnitudeSeverity: config.quakeSeverityMagnitudes,
        significanceSeverity: config.quakeSeveritySignificance,
      },
      confidenceMethod:
        "Data-quality index: 0.85 for a USGS-reviewed event, 0.65 for a preliminary event. This assesses catalogue review status, not hazard or causal certainty.",
    },
  };
}
