import type {
  EventCategory,
  EventProvider,
  EventSeverity,
  EventType,
  WorldEvent,
} from "../types";
import { fetchText } from "../../providers/http";

type EonetGeometry = {
  date?: string;
  type?: string;
  coordinates?: unknown;
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
};

type EonetEvent = {
  id?: string;
  title?: string;
  description?: string | null;
  link?: string;
  closed?: string | null;
  categories?: { id?: string; title?: string }[];
  sources?: { id?: string; url?: string }[];
  geometry?: EonetGeometry[];
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
  magnitudeDescription?: string | null;
};

type EonetPayload = { events?: EonetEvent[] };

const CATEGORY_MAP: Record<
  string,
  { category: EventCategory; type: EventType }
> = {
  drought: { category: "climate", type: "drought" },
  dustHaze: { category: "environment", type: "dust_haze" },
  earthquakes: { category: "natural_hazard", type: "earthquake" },
  floods: { category: "natural_hazard", type: "flood" },
  landslides: { category: "natural_hazard", type: "landslide" },
  seaLakeIce: { category: "climate", type: "sea_lake_ice" },
  severeStorms: { category: "natural_hazard", type: "severe_storm" },
  snow: { category: "climate", type: "snow" },
  tempExtremes: { category: "climate", type: "temperature_extreme" },
  volcanoes: { category: "natural_hazard", type: "volcano" },
  waterColor: { category: "environment", type: "water_anomaly" },
  wildfires: { category: "natural_hazard", type: "wildfire" },
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function flattenCoordinates(
  value: unknown,
  out: [number, number][] = [],
): [number, number][] {
  if (!Array.isArray(value)) return out;
  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  ) {
    out.push([value[0], value[1]]);
    return out;
  }
  for (const child of value) flattenCoordinates(child, out);
  return out;
}

function compactLocation(geometry: EonetGeometry) {
  const points = flattenCoordinates(geometry.coordinates);
  if (
    !points.length ||
    points.some(([lon, lat]) => Math.abs(lon) > 180 || Math.abs(lat) > 90)
  )
    return null;
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const geometryType =
    geometry.type === "Point"
      ? "point"
      : geometry.type === "LineString"
        ? "track"
        : "polygon";
  return {
    latitude: Number(((minLat + maxLat) / 2).toFixed(5)),
    longitude: Number(((minLon + maxLon) / 2).toFixed(5)),
    ...(points.length > 1
      ? {
          bbox: [minLon, minLat, maxLon, maxLat] as [
            number,
            number,
            number,
            number,
          ],
        }
      : {}),
    geometryType,
  } as const;
}

function categoryFor(event: EonetEvent) {
  for (const item of event.categories ?? []) {
    if (item.id && CATEGORY_MAP[item.id]) return CATEGORY_MAP[item.id];
  }
  return { category: "natural_hazard" as const, type: "other" as const };
}

function severityFor(event: EonetEvent, type: EventType): EventSeverity {
  const magnitude =
    finiteNumber(event.magnitudeValue) ??
    finiteNumber(event.geometry?.at(-1)?.magnitudeValue);
  if (type === "earthquake" && magnitude !== null) {
    if (magnitude >= 6) return "significant";
    if (magnitude >= 5) return "elevated";
    return "notable";
  }
  return "notable";
}

export class EonetEventProvider implements EventProvider {
  readonly id = "eonet";
  readonly name = "NASA EONET";
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async fetchEvents(
    options: { now?: Date; days?: number; limit?: number } = {},
  ): Promise<WorldEvent[]> {
    const days = Math.max(1, Math.min(30, options.days ?? 7));
    const limit = Math.max(1, Math.min(1000, options.limit ?? 500));
    const url = new URL("https://eonet.gsfc.nasa.gov/api/v3/events");
    url.searchParams.set("status", "all");
    url.searchParams.set("days", String(days));
    url.searchParams.set("limit", String(limit));
    const { text } = await fetchText(url.toString(), {
      fetcher: this.fetcher,
      attempts: 2,
      timeoutMs: 30_000,
    });
    const payload = JSON.parse(text) as EonetPayload;
    const now = options.now ?? new Date();
    const output: WorldEvent[] = [];

    for (const raw of payload.events ?? []) {
      if (!raw.id || !raw.title) continue;
      const latestGeometry = raw.geometry
        ?.filter((g) => g.date && g.coordinates)
        .at(-1);
      if (
        !latestGeometry?.date ||
        !Number.isFinite(Date.parse(latestGeometry.date)) ||
        (raw.closed && !Number.isFinite(Date.parse(raw.closed)))
      )
        continue;
      const location = compactLocation(latestGeometry);
      if (!location) continue;
      const mapped = categoryFor(raw);
      const primarySource = raw.sources?.find((source) => source.url) ?? null;
      const magnitudeValue =
        finiteNumber(raw.magnitudeValue) ??
        finiteNumber(latestGeometry.magnitudeValue);
      const magnitudeUnit =
        raw.magnitudeUnit ?? latestGeometry.magnitudeUnit ?? null;
      output.push({
        schemaVersion: 1,
        id: `eonet:${raw.id}`,
        category: mapped.category,
        type: mapped.type,
        title: raw.title,
        description: raw.description?.trim() || null,
        status: raw.closed ? "resolved" : "active",
        severity: severityFor(raw, mapped.type),
        confidence: 0.8,
        startedAt: raw.geometry?.[0]?.date ?? latestGeometry.date,
        updatedAt: raw.closed ?? latestGeometry.date ?? now.toISOString(),
        endedAt: raw.closed ?? null,
        location,
        magnitude: {
          value: magnitudeValue,
          unit: magnitudeUnit,
          description: raw.magnitudeDescription ?? null,
        },
        source: {
          provider: this.id,
          name: primarySource?.id
            ? `NASA EONET · ${primarySource.id}`
            : "NASA EONET",
          url:
            primarySource?.url ??
            raw.link ??
            `https://eonet.gsfc.nasa.gov/api/v3/events/${raw.id}`,
          upstreamId: raw.id,
        },
        secondarySources: (raw.sources ?? [])
          .filter((source) => source.url && source.url !== primarySource?.url)
          .slice(0, 5)
          .map((source) => ({
            name: source.id ?? "External source",
            url: source.url!,
          })),
        properties: {
          eonetCategory: raw.categories?.[0]?.id ?? null,
          geometrySamples: raw.geometry?.length ?? 0,
          collectedAt: now.toISOString(),
        },
      });
    }
    return output;
  }
}
