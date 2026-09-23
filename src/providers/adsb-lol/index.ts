import { createHash } from "node:crypto";
import {
  latLngToCell,
  cellToBoundary,
  greatCircleDistance,
  UNITS,
} from "h3-js";
import { z } from "zod";
import { cellGeography } from "../../signals/geography";
import { fetchText } from "../http";
import { DataError, errorCode } from "../../server/log";
import { mapLimited, type ScopeCollection } from "../batch";
import type {
  FetchContext,
  NormalizedBatch,
  ObservationProvider,
  RawBatch,
  Observation,
} from "../contract";
import { AVIATION_REGIONS } from "./regions";
const schema = z.object({
  now: z.number().positive(),
  ac: z.array(
    z.object({
      hex: z.string(),
      lat: z.number().min(-90).max(90).optional(),
      lon: z.number().min(-180).max(180).optional(),
      seen_pos: z.number().optional(),
      alt_baro: z.union([z.number(), z.string()]).optional(),
    }),
  ),
  msg: z.string().optional(),
});
export function normalizeAdsb(
  data: unknown,
  latitude: number,
  longitude: number,
  fetchedAt: string,
): Observation[] {
  const raw = schema.parse(data);
  const time = raw.now > 1e12 ? raw.now : raw.now * 1000;
  if (
    time > Date.parse(fetchedAt) + 30000 ||
    Date.parse(fetchedAt) - time > 120000
  )
    throw new DataError("stale_snapshot");
  const seen = new Set<string>();
  const cells = new Map<string, number>();
  for (const aircraft of raw.ac) {
    if (
      seen.has(aircraft.hex) ||
      aircraft.lat === undefined ||
      aircraft.lon === undefined ||
      typeof aircraft.alt_baro !== "number" ||
      aircraft.seen_pos === undefined ||
      aircraft.seen_pos < 0 ||
      aircraft.seen_pos > 15
    )
      continue;
    seen.add(aircraft.hex);
    const cell = latLngToCell(aircraft.lat, aircraft.lon, 2);
    // Avoid partial-cell counts caused by a circular query boundary.
    if (
      cellToBoundary(cell).some(
        (point) =>
          greatCircleDistance([latitude, longitude], point, UNITS.km) >
          250 * 1.852,
      )
    )
      continue;
    cells.set(cell, (cells.get(cell) ?? 0) + 1);
  }
  const timestamp = new Date(time).toISOString();
  return [...cells].map(([cellId, value]) => {
    const geo = cellGeography(cellId);
    const upstreamId = `${cellId}:${Math.floor(time / 3600000)}`;
    return {
      id: `adsblol:${createHash("sha256").update(upstreamId).digest("hex")}`,
      provider: "adsblol",
      upstreamId,
      type: "aviation",
      latitude: geo.latitude,
      longitude: geo.longitude,
      timestamp,
      sourceUpdatedAt: fetchedAt,
      value,
      cellId,
      quality: 0.5,
      sourceUrl: "https://www.adsb.lol/",
      properties: {
        metric: "observed_airborne_aircraft_snapshot",
        country: geo.country,
        geographicScope: "h3",
        sampleSize: value,
        snapshotSeconds: 1,
        coverage: "receiver-coverage-unknown",
        absentCellsAreUnknown: true,
        license: "ODbL-1.0",
        attribution: "ADSB.lol",
      },
      active: true,
    } satisfies Observation;
  });
}
export class AdsbProvider implements ObservationProvider<NormalizedBatch> {
  id = "adsblol";
  name = "ADSB.lol";
  type = "aviation" as const;
  async fetchRawData(
    context: FetchContext,
  ): Promise<RawBatch<NormalizedBatch>> {
    const results = await mapLimited(AVIATION_REGIONS, 2, async (region) => {
      const { text } = await fetchText(
        `https://api.adsb.lol/v2/point/${region[1]}/${region[2]}/250`,
        { timeoutMs: 10000, attempts: 2 },
      );
      return normalizeAdsb(
        JSON.parse(text),
        region[1],
        region[2],
        new Date().toISOString(),
      );
    });
    const scopes: ScopeCollection[] = results.map((r, i) => ({
      id: AVIATION_REGIONS[i][0],
      label: AVIATION_REGIONS[i][0],
      ok: r.status === "fulfilled",
      latestObservationAt:
        r.status === "fulfilled" ? (r.value.at(-1)?.timestamp ?? null) : null,
      error: r.status === "rejected" ? errorCode(r.reason) : null,
    }));
    const cells = new Map<string, Observation>();
    for (const result of results)
      if (result.status === "fulfilled")
        for (const o of result.value) {
          const prior = cells.get(o.cellId);
          if (!prior || o.timestamp > prior.timestamp) cells.set(o.cellId, o);
        }
    const observations = [...cells.values()];
    if (!observations.length)
      throw new DataError("no_usable_aviation_coverage");
    const timestamps = observations.map((o) => o.timestamp).sort();
    const sourceAsOf = timestamps.at(-1)!;
    const data: NormalizedBatch = {
      observations,
      received: observations.reduce((n, o) => n + o.value!, 0),
      rejected: 0,
      sourceAsOf,
      coverageStart: timestamps[0],
      coverageEnd: sourceAsOf,
      completeSnapshot: false,
      scopes,
    };
    return {
      data,
      fetchedAt: context.now.toISOString(),
      sourceAsOf,
      coverageStart: data.coverageStart,
      coverageEnd: data.coverageEnd,
      sourceUrl: "https://api.adsb.lol/docs",
    };
  }
  normalize(raw: RawBatch<NormalizedBatch>) {
    return raw.data;
  }
}
