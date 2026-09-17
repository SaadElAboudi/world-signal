import { z } from "zod";
import { latLngToCell } from "h3-js";
import { createHash } from "node:crypto";
import { fetchText } from "../http";
import { DataError } from "../../server/log";
import type {
  FetchContext,
  NormalizedBatch,
  ObservationProvider,
  RawBatch,
} from "../contract";
const envelope = z.object({
  type: z.literal("FeatureCollection"),
  metadata: z.object({
    generated: z.number().finite(),
    count: z.number().int().nonnegative(),
    status: z.literal(200),
  }),
  features: z.array(z.unknown()),
});
const event = z.object({
  id: z.string().min(1),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
      z.number().finite().nullable(),
    ]),
  }),
  properties: z
    .object({
      time: z.number().finite(),
      updated: z.number().finite(),
      mag: z.number().finite().nullable(),
      place: z.string().nullable(),
      type: z.string(),
      status: z.string().nullable(),
      sig: z.number().nullable().optional(),
      url: z.string().nullable().optional(),
    })
    .passthrough(),
});
export class UsgsProvider implements ObservationProvider<unknown> {
  id = "usgs";
  name = "USGS";
  type = "earthquake" as const;
  async fetchRawData(context: FetchContext): Promise<RawBatch<unknown>> {
    const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_${context.history ? "month" : "day"}.geojson`;
    const response = await fetchText(url);
    let data: unknown;
    try {
      data = JSON.parse(response.text);
    } catch {
      throw new DataError("invalid_json");
    }
    const parsed = envelope.safeParse(data);
    if (
      !parsed.success ||
      parsed.data.features.length !== parsed.data.metadata.count
    )
      throw new DataError("invalid_usgs_response");
    const generated = parsed.data.metadata.generated;
    if (
      generated > context.now.getTime() + 300000 ||
      generated < Date.UTC(2000, 0)
    )
      throw new DataError("invalid_source_timestamp");
    return {
      data,
      fetchedAt: context.now.toISOString(),
      sourceAsOf: new Date(generated).toISOString(),
      coverageStart: new Date(
        generated - (context.history ? 30 : 1) * 86400000,
      ).toISOString(),
      coverageEnd: new Date(generated).toISOString(),
      sourceUrl: url,
    };
  }
  normalize(raw: RawBatch<unknown>): NormalizedBatch {
    const parsed = envelope.safeParse(raw.data);
    if (!parsed.success) throw new DataError("invalid_usgs_response");
    let rejected = 0;
    const observations: NormalizedBatch["observations"] = [];
    const seen = new Set<string>();
    for (const feature of parsed.data.features) {
      const result = event.safeParse(feature);
      if (!result.success) {
        rejected++;
        continue;
      }
      const e = result.data;
      if (
        e.properties.time <= 0 ||
        e.properties.time > Date.parse(raw.sourceAsOf) + 300000 ||
        e.properties.updated <= 0
      ) {
        rejected++;
        continue;
      }
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      const [longitude, latitude, depth] = e.geometry.coordinates;
      const sourceUrl = e.properties.url?.startsWith(
        "https://earthquake.usgs.gov/",
      )
        ? e.properties.url
        : `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(e.id)}`;
      observations.push({
        id: createHash("sha256").update(`usgs:${e.id}`).digest("hex"),
        provider: this.id,
        upstreamId: e.id,
        type: this.type,
        latitude,
        longitude,
        timestamp: new Date(e.properties.time).toISOString(),
        sourceUpdatedAt: new Date(e.properties.updated).toISOString(),
        value: e.properties.mag,
        cellId: latLngToCell(latitude, longitude, 2),
        quality: e.properties.status === "reviewed" ? 1 : 0.7,
        sourceUrl,
        active:
          e.properties.type === "earthquake" &&
          e.properties.status !== "deleted",
        properties: {
          ...e.properties,
          magnitude: e.properties.mag,
          depth,
          upstreamSource: raw.sourceUrl,
        },
      });
    }
    return {
      observations,
      rejected,
      received: parsed.data.features.length,
      sourceAsOf: raw.sourceAsOf,
      coverageStart: raw.coverageStart,
      coverageEnd: raw.coverageEnd,
    };
  }
}
