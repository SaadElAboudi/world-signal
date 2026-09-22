import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { EventProvider, WorldEvent } from "../types";

const API_ROOT = "https://api.ioda.inetintel.cc.gatech.edu/v2";
const eventSchema = z.object({
  datasource: z.string().min(1),
  location: z.string().min(1),
  start: z.number().int().nonnegative(),
  duration: z.number().int().nonnegative(),
  status: z.number().optional(),
  score: z.number().finite().nullable().optional(),
  location_name: z.string().min(1),
  overlaps_window: z.boolean().optional(),
});
const responseSchema = z.union([
  z.array(eventSchema),
  z.object({ data: z.array(eventSchema) }),
]);

type FetchLike = typeof fetch;
type CountryLocation = { latitude: number; longitude: number };
type LocationResolver = (code: string) => Promise<CountryLocation | null>;

type GeoJsonFeature = {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: unknown };
};

let countryLocationCache: Map<string, CountryLocation> | null = null;

function alpha2(properties: Record<string, unknown> | undefined) {
  if (!properties) return null;
  for (const key of ["ISO_A2", "ISO_A2_EH", "WB_A2", "POSTAL", "iso_a2", "ISO2"]) {
    const value = properties[key];
    if (typeof value === "string" && /^[A-Za-z]{2}$/.test(value) && value !== "-99")
      return value.toUpperCase();
  }
  return null;
}

function coordinateBounds(
  value: unknown,
  bounds = { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 },
) {
  if (!Array.isArray(value)) return bounds;
  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    bounds.minLon = Math.min(bounds.minLon, value[0]);
    bounds.maxLon = Math.max(bounds.maxLon, value[0]);
    bounds.minLat = Math.min(bounds.minLat, value[1]);
    bounds.maxLat = Math.max(bounds.maxLat, value[1]);
    return bounds;
  }
  for (const child of value) coordinateBounds(child, bounds);
  return bounds;
}

async function defaultCountryLocation(code: string): Promise<CountryLocation | null> {
  if (!countryLocationCache) {
    const raw = await readFile(
      path.join(process.cwd(), "public/geo/countries.geojson"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { features?: GeoJsonFeature[] };
    const map = new Map<string, CountryLocation>();
    for (const feature of parsed.features ?? []) {
      const countryCode = alpha2(feature.properties);
      if (!countryCode || !feature.geometry?.coordinates) continue;
      const bounds = coordinateBounds(feature.geometry.coordinates);
      if (bounds.maxLat < bounds.minLat || bounds.maxLon < bounds.minLon) continue;
      map.set(countryCode, {
        latitude: (bounds.minLat + bounds.maxLat) / 2,
        longitude: (bounds.minLon + bounds.maxLon) / 2,
      });
    }
    countryLocationCache = map;
  }
  return countryLocationCache.get(code.toUpperCase()) ?? null;
}

function severityForScore(score: number | null | undefined) {
  if (score !== null && score !== undefined && score >= 1000)
    return "significant" as const;
  if (score !== null && score !== undefined && score >= 250)
    return "elevated" as const;
  return "notable" as const;
}

export class IodaInternetOutageProvider implements EventProvider {
  id = "ioda";
  name = "IODA";
  private readonly fetchImpl: FetchLike;
  private readonly resolveLocation: LocationResolver;
  private readonly endpoint: string;

  constructor(
    options: {
      fetchImpl?: FetchLike;
      resolveLocation?: LocationResolver;
      endpoint?: string;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveLocation = options.resolveLocation ?? defaultCountryLocation;
    this.endpoint = options.endpoint ?? `${API_ROOT}/outages/events`;
  }

  async fetchEvents(
    options: { now?: Date; days?: number; limit?: number } = {},
  ): Promise<WorldEvent[]> {
    const now = options.now ?? new Date();
    // A long window is intentional: IODA outages can remain open for weeks.
    // We fetch detected events, not raw measurements, so this remains compact.
    const days = Math.min(Math.max(options.days ?? 90, 1), 90);
    const from = Math.floor((now.getTime() - days * 86_400_000) / 1000);
    const until = Math.floor(now.getTime() / 1000);
    const url = new URL(this.endpoint);
    url.searchParams.set("from", String(from));
    url.searchParams.set("until", String(until));
    url.searchParams.set("entityType", "country");
    url.searchParams.set("format", "codf");
    url.searchParams.set(
      "limit",
      String(Math.min(Math.max(options.limit ?? 500, 1), 2000)),
    );
    url.searchParams.set("orderBy", "time/desc");

    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`IODA request failed: ${response.status}`);
    const parsed = responseSchema.parse(await response.json());
    const rows = Array.isArray(parsed) ? parsed : parsed.data;
    const events: WorldEvent[] = [];

    for (const row of rows) {
      const match = /^country\/([A-Za-z]{2})$/.exec(row.location);
      if (!match) continue;
      const countryCode = match[1].toUpperCase();
      const location = await this.resolveLocation(countryCode);
      if (!location) continue;
      const startedAt = new Date(row.start * 1000);
      const apparentEnd = new Date((row.start + row.duration) * 1000);
      const active = apparentEnd.getTime() >= now.getTime() - 20 * 60_000;
      const stableKey = `${countryCode}:${row.datasource}:${row.start}`;
      const id = `ioda:${createHash("sha256").update(stableKey).digest("hex")}`;
      const sourceUrl = `https://ioda.inetintel.cc.gatech.edu/country/${countryCode}`;
      events.push({
        schemaVersion: 1,
        id,
        category: "infrastructure",
        type: "internet_outage",
        title: `Internet outage detected in ${row.location_name}`,
        description:
          "IODA detected a macroscopic Internet connectivity disruption from network measurements.",
        status: active ? "active" : "resolved",
        severity: severityForScore(row.score),
        confidence: 0.75,
        startedAt: startedAt.toISOString(),
        updatedAt: now.toISOString(),
        endedAt: active ? null : apparentEnd.toISOString(),
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          geometryType: "point",
        },
        magnitude: {
          value: row.score ?? null,
          unit:
            row.score === null || row.score === undefined ? null : "IODA score",
          description:
            row.score === null || row.score === undefined
              ? null
              : "IODA outage event score",
        },
        source: {
          provider: this.id,
          name: this.name,
          url: sourceUrl,
          upstreamId: stableKey,
        },
        secondarySources: [],
        properties: {
          countryCode,
          country: row.location_name,
          datasource: row.datasource,
          score: row.score ?? null,
          durationSeconds: row.duration,
          overlapsWindow: row.overlaps_window ?? false,
          geographicScope: "country",
          causalInterpretation: false,
        },
      });
    }
    return events;
  }
}
