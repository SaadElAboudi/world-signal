import { cellToLatLng, getRes0Cells } from "h3-js";
import { fetchText } from "../../providers/http";
import type { EventSeverity, EventType, WorldEvent } from "../types";

type HourlyWeather = {
  time?: string[];
  temperature_2m?: Array<number | null>;
  precipitation?: Array<number | null>;
  wind_gusts_10m?: Array<number | null>;
};

type OpenMeteoLocation = {
  latitude?: number;
  longitude?: number;
  hourly?: HourlyWeather;
};

type ProviderOptions = {
  fetcher?: typeof fetch;
  endpoint?: string;
  apiKey?: string;
  batchSize?: number;
};

type Extreme = {
  kind: "heat" | "cold" | "wind" | "rain";
  type: EventType;
  severity: EventSeverity;
  value: number;
  unit: string;
  startedAt: string;
  endedAt: string;
  label: string;
};

const HORIZON_HOURS = 24;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function severityAt(value: number, elevated: number, significant: number): EventSeverity | null {
  if (value >= significant) return "significant";
  if (value >= elevated) return "elevated";
  return null;
}

function detectExtremes(hourly: HourlyWeather): Extreme[] {
  const times = hourly.time ?? [];
  const temperatures = hourly.temperature_2m ?? [];
  const precipitation = hourly.precipitation ?? [];
  const gusts = hourly.wind_gusts_10m ?? [];
  const output: Extreme[] = [];

  const hottest = temperatures.reduce<{ value: number; index: number } | null>((best, value, index) => {
    if (!finite(value)) return best;
    return !best || value > best.value ? { value, index } : best;
  }, null);
  if (hottest && times[hottest.index]) {
    const severity = severityAt(hottest.value, 40, 45);
    if (severity) output.push({
      kind: "heat",
      type: "temperature_extreme",
      severity,
      value: hottest.value,
      unit: "°C",
      startedAt: times[hottest.index],
      endedAt: times[hottest.index],
      label: "Extreme heat forecast",
    });
  }

  const coldest = temperatures.reduce<{ value: number; index: number } | null>((best, value, index) => {
    if (!finite(value)) return best;
    return !best || value < best.value ? { value, index } : best;
  }, null);
  if (coldest && times[coldest.index]) {
    const severity = coldest.value <= -35 ? "significant" : coldest.value <= -25 ? "elevated" : null;
    if (severity) output.push({
      kind: "cold",
      type: "temperature_extreme",
      severity,
      value: coldest.value,
      unit: "°C",
      startedAt: times[coldest.index],
      endedAt: times[coldest.index],
      label: "Extreme cold forecast",
    });
  }

  const strongestGust = gusts.reduce<{ value: number; index: number } | null>((best, value, index) => {
    if (!finite(value)) return best;
    return !best || value > best.value ? { value, index } : best;
  }, null);
  if (strongestGust && times[strongestGust.index]) {
    const severity = severityAt(strongestGust.value, 90, 120);
    if (severity) output.push({
      kind: "wind",
      type: "high_wind",
      severity,
      value: strongestGust.value,
      unit: "km/h",
      startedAt: times[strongestGust.index],
      endedAt: times[strongestGust.index],
      label: "High-wind forecast",
    });
  }

  let wettest: { value: number; index: number } | null = null;
  for (let index = 0; index < precipitation.length; index++) {
    let total = 0;
    let observed = 0;
    for (let offset = Math.max(0, index - 5); offset <= index; offset++) {
      const value = precipitation[offset];
      if (!finite(value)) continue;
      total += value;
      observed++;
    }
    if (observed === 6 && (!wettest || total > wettest.value)) wettest = { value: total, index };
  }
  if (wettest && times[wettest.index]) {
    const severity = severityAt(wettest.value, 50, 80);
    if (severity) output.push({
      kind: "rain",
      type: "heavy_rain",
      severity,
      value: Number(wettest.value.toFixed(1)),
      unit: "mm/6h",
      startedAt: times[Math.max(0, wettest.index - 5)] ?? times[wettest.index],
      endedAt: times[wettest.index],
      label: "Heavy-rain forecast",
    });
  }

  return output;
}

function eventId(cellId: string, extreme: Extreme) {
  const day = extreme.startedAt.slice(0, 10);
  return `open-meteo:${cellId}:${extreme.kind}:${day}`;
}

export class OpenMeteoExtremeWeatherProvider {
  readonly id = "open-meteo";
  readonly name = "Open-Meteo";
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly batchSize: number;

  constructor(options: ProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.endpoint = options.endpoint ?? "https://api.open-meteo.com/v1/forecast";
    this.apiKey = options.apiKey;
    this.batchSize = Math.max(1, Math.min(50, options.batchSize ?? 20));
  }

  async fetchEvents(options: { now?: Date; limit?: number } = {}): Promise<WorldEvent[]> {
    const now = options.now ?? new Date();
    const cells = getRes0Cells();
    const output: WorldEvent[] = [];

    for (let index = 0; index < cells.length; index += this.batchSize) {
      const chunk = cells.slice(index, index + this.batchSize);
      const centers = chunk.map((cell) => cellToLatLng(cell));
      const url = new URL(this.endpoint);
      url.searchParams.set("latitude", centers.map(([lat]) => lat.toFixed(5)).join(","));
      url.searchParams.set("longitude", centers.map(([, lon]) => lon.toFixed(5)).join(","));
      url.searchParams.set("hourly", "temperature_2m,precipitation,wind_gusts_10m");
      url.searchParams.set("forecast_hours", String(HORIZON_HOURS));
      url.searchParams.set("timezone", "UTC");
      url.searchParams.set("wind_speed_unit", "kmh");
      if (this.apiKey) url.searchParams.set("apikey", this.apiKey);

      const { text } = await fetchText(url.toString(), {
        fetcher: this.fetcher,
        attempts: 2,
        timeoutMs: 30_000,
      });
      const parsed = JSON.parse(text) as OpenMeteoLocation | OpenMeteoLocation[];
      const locations = Array.isArray(parsed) ? parsed : [parsed];
      if (locations.length !== chunk.length) throw new Error("Open-Meteo location count mismatch");

      locations.forEach((location, locationIndex) => {
        if (!location.hourly) return;
        const cellId = chunk[locationIndex];
        const [latitude, longitude] = centers[locationIndex];
        for (const extreme of detectExtremes(location.hourly)) {
          const id = eventId(cellId, extreme);
          output.push({
            schemaVersion: 1,
            id,
            category: extreme.type === "heavy_rain" || extreme.type === "high_wind" ? "natural_hazard" : "climate",
            type: extreme.type,
            title: extreme.label,
            description: `Coarse global weather sentinel forecast at H3 resolution 0. ${extreme.value} ${extreme.unit}.`,
            status: "active",
            severity: extreme.severity,
            confidence: 0.6,
            startedAt: new Date(`${extreme.startedAt}Z`.replace("ZZ", "Z")).toISOString(),
            updatedAt: new Date(`${extreme.endedAt}Z`.replace("ZZ", "Z")).toISOString(),
            endedAt: null,
            location: {
              latitude: Number(latitude.toFixed(5)),
              longitude: Number(longitude.toFixed(5)),
              geometryType: "point",
            },
            magnitude: {
              value: extreme.value,
              unit: extreme.unit,
              description: extreme.kind === "rain" ? "Maximum rolling six-hour precipitation in the next 24 hours" : "Maximum forecast extremum in the next 24 hours",
            },
            source: {
              provider: this.id,
              name: "Open-Meteo",
              url: "https://open-meteo.com/",
              upstreamId: id,
            },
            secondarySources: [],
            properties: {
              forecast: true,
              forecastHorizonHours: HORIZON_HOURS,
              grid: "h3-r0-centroid",
              cellId,
              extremeKind: extreme.kind,
              collectedAt: now.toISOString(),
              thresholdMethod: "absolute-extreme-v1",
            },
          });
        }
      });
    }

    const limit = Math.max(1, Math.min(1000, options.limit ?? 1000));
    return output
      .sort((a, b) => {
        const rank = { significant: 3, elevated: 2, notable: 1, info: 0 } as const;
        return rank[b.severity] - rank[a.severity] || b.magnitude.value! - a.magnitude.value!;
      })
      .slice(0, limit);
  }
}
