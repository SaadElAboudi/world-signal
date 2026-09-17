import { createHash } from "node:crypto";
import { latLngToCell } from "h3-js";
import { z } from "zod";
import type { NormalizedBatch, Observation } from "../contract";
const seriesSchema = z.object({
  entityType: z.literal("country"),
  entityCode: z.string(),
  datasource: z.enum(["bgp", "ping-slash24"]),
  from: z.number().int().nonnegative(),
  until: z.number().int().positive(),
  step: z.number().int().positive(),
  nativeStep: z.number().int().positive(),
  values: z.array(z.number().nonnegative().nullable()),
});
export interface InternetCountry {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
}
// Deliberately accepts only two documented measurements. Google traffic, packet
// loss and latency are different quantities and must not enter this count series.
export function normalizeIodaSeries(
  data: unknown,
  country: InternetCountry,
  fetchedAt: string,
): NormalizedBatch {
  const series = seriesSchema.parse(data);
  if (
    series.entityCode !== country.code ||
    series.until <= series.from ||
    !Number.isFinite(Date.parse(fetchedAt))
  )
    throw new Error("Invalid IODA series scope or time");
  if (
    !/^[A-Z]{2}$/.test(country.code) ||
    !country.name ||
    !Number.isFinite(country.latitude) ||
    Math.abs(country.latitude) > 90 ||
    !Number.isFinite(country.longitude) ||
    Math.abs(country.longitude) > 180
  )
    throw new Error("Invalid country metadata");
  const cellId = latLngToCell(country.latitude, country.longitude, 2);
  const observations: Observation[] = [];
  const metric =
    series.datasource === "bgp"
      ? "bgp_visible_slash24_blocks"
      : "probing_responsive_slash24_blocks";
  for (let i = 0; i < series.values.length; i++) {
    const value = series.values[i];
    // Null means unavailable, not zero reachable networks.
    if (value === null) continue;
    const seconds = series.from + i * series.step;
    if (seconds >= series.until || seconds * 1000 > Date.parse(fetchedAt))
      throw new Error("IODA measurement outside reported interval");
    const timestamp = new Date(seconds * 1000).toISOString();
    const upstreamId = `${country.code}:${series.datasource}:${seconds}:${series.step}`;
    observations.push({
      id: `ioda:${createHash("sha256").update(upstreamId).digest("hex")}`,
      upstreamId,
      provider: "ioda",
      type: "internet",
      timestamp,
      sourceUpdatedAt: fetchedAt,
      latitude: country.latitude,
      longitude: country.longitude,
      value,
      cellId,
      quality: 0.6,
      sourceUrl: `https://ioda.inetintel.cc.gatech.edu/country/${country.code}`,
      properties: {
        metric,
        country: country.name,
        countryCode: country.code,
        geographicScope: "country",
        measurementSource: series.datasource,
        stepSeconds: series.step,
        nativeStepSeconds: series.nativeStep,
        missingSamples: series.values.filter((v) => v === null).length,
        coverage: "measurement-network-only",
        revisionTimeKnown: false,
      },
      active: true,
    });
  }
  const latest = observations[observations.length - 1]?.timestamp;
  if (!latest) throw new Error("IODA series has no observed measurements");
  return {
    observations,
    received: series.values.length,
    rejected: 0,
    sourceAsOf: latest,
    coverageStart: new Date(series.from * 1000).toISOString(),
    coverageEnd: new Date(series.until * 1000).toISOString(),
  };
}
