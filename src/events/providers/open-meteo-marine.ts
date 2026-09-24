import { createBudgetedFetch } from "../../server/budgeted-fetch";
import { fetchText } from "../../providers/http";
import type { EventSeverity, WorldEvent } from "../types";

type MarineRegion = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

type MarineHourly = {
  time?: string[];
  sea_surface_temperature?: Array<number | null>;
};

type MarineLocation = {
  latitude?: number;
  longitude?: number;
  hourly?: MarineHourly;
};

type Options = {
  fetcher?: typeof fetch;
  endpoint?: string;
  apiKey?: string;
  batchSize?: number;
  regions?: readonly MarineRegion[];
};

export const MARINE_SENTINELS: readonly MarineRegion[] = [
  { id: "north-atlantic", name: "North Atlantic", latitude: 40, longitude: -35 },
  { id: "tropical-atlantic", name: "Tropical Atlantic", latitude: 10, longitude: -35 },
  { id: "caribbean", name: "Caribbean Sea", latitude: 16, longitude: -72 },
  { id: "gulf-mexico", name: "Gulf of Mexico", latitude: 25, longitude: -90 },
  { id: "mediterranean-west", name: "Western Mediterranean", latitude: 38, longitude: 4 },
  { id: "mediterranean-east", name: "Eastern Mediterranean", latitude: 34, longitude: 27 },
  { id: "north-sea", name: "North Sea", latitude: 56, longitude: 3 },
  { id: "baltic", name: "Baltic Sea", latitude: 58, longitude: 19 },
  { id: "arabian-sea", name: "Arabian Sea", latitude: 15, longitude: 65 },
  { id: "bay-bengal", name: "Bay of Bengal", latitude: 14, longitude: 87 },
  { id: "equatorial-indian", name: "Equatorial Indian Ocean", latitude: 0, longitude: 80 },
  { id: "south-indian", name: "South Indian Ocean", latitude: -30, longitude: 80 },
  { id: "western-pacific", name: "Western Pacific", latitude: 20, longitude: 140 },
  { id: "equatorial-pacific-west", name: "Equatorial Pacific West", latitude: 0, longitude: 155 },
  { id: "equatorial-pacific-central", name: "Equatorial Pacific Central", latitude: 0, longitude: -160 },
  { id: "equatorial-pacific-east", name: "Equatorial Pacific East", latitude: 0, longitude: -110 },
  { id: "north-pacific", name: "North Pacific", latitude: 40, longitude: -165 },
  { id: "south-pacific", name: "South Pacific", latitude: -35, longitude: -135 },
  { id: "coral-sea", name: "Coral Sea", latitude: -18, longitude: 155 },
  { id: "tasman-sea", name: "Tasman Sea", latitude: -40, longitude: 160 },
  { id: "south-atlantic", name: "South Atlantic", latitude: -35, longitude: -20 },
  { id: "brazil-current", name: "Brazil Current", latitude: -28, longitude: -45 },
  { id: "benguela", name: "Benguela Current", latitude: -25, longitude: 10 },
  { id: "southern-ocean", name: "Southern Ocean", latitude: -55, longitude: 30 },
];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values: Array<number | null | undefined>) {
  const valid = values.filter(finite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function severity(deltaC: number): EventSeverity | null {
  if (deltaC >= 5) return "significant";
  if (deltaC >= 3.5) return "elevated";
  if (deltaC >= 2) return "notable";
  return null;
}

export function detectSstWarming(
  hourly: MarineHourly,
  now = new Date(),
): { currentC: number; baselineC: number; deltaC: number; startedAt: string; updatedAt: string; severity: EventSeverity } | null {
  const times = hourly.time ?? [];
  const values = hourly.sea_surface_temperature ?? [];
  if (times.length !== values.length || values.length < 120) return null;

  const parsed = times.map((time, index) => ({
    time: Date.parse(`${time}Z`.replace("ZZ", "Z")),
    value: values[index],
  }));
  const usable = parsed.filter(
    (point) =>
      Number.isFinite(point.time) &&
      point.time <= now.getTime() &&
      point.time >= now.getTime() - 8 * 86_400_000,
  );
  if (usable.length < 120) return null;

  const currentWindow = usable.slice(-6);
  const targetBaseline = currentWindow[currentWindow.length - 1].time - 7 * 86_400_000;
  const baselineWindow = usable
    .filter((point) => Math.abs(point.time - targetBaseline) <= 3 * 3_600_000)
    .slice(0, 6);
  if (baselineWindow.length < 4) return null;

  const currentC = mean(currentWindow.map((point) => point.value));
  const baselineC = mean(baselineWindow.map((point) => point.value));
  if (currentC === null || baselineC === null) return null;

  const deltaC = Number((currentC - baselineC).toFixed(2));
  const level = severity(deltaC);
  if (!level) return null;
  return {
    currentC: Number(currentC.toFixed(2)),
    baselineC: Number(baselineC.toFixed(2)),
    deltaC,
    startedAt: new Date(baselineWindow[0].time).toISOString(),
    updatedAt: new Date(currentWindow[currentWindow.length - 1].time).toISOString(),
    severity: level,
  };
}

export class OpenMeteoMarineProvider {
  readonly id = "open-meteo-marine";
  readonly name = "Open-Meteo Marine";
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly batchSize: number;
  private readonly regions: readonly MarineRegion[];

  constructor(options: Options = {}) {
    this.fetcher = options.fetcher ?? createBudgetedFetch("open-meteo");
    this.endpoint = options.endpoint ?? "https://marine-api.open-meteo.com/v1/marine";
    this.apiKey = options.apiKey;
    this.batchSize = Math.max(1, Math.min(25, options.batchSize ?? 12));
    this.regions = options.regions ?? MARINE_SENTINELS;
  }

  async fetchEvents(options: { now?: Date; limit?: number } = {}): Promise<WorldEvent[]> {
    const now = options.now ?? new Date();
    const output: WorldEvent[] = [];
    for (let index = 0; index < this.regions.length; index += this.batchSize) {
      const chunk = this.regions.slice(index, index + this.batchSize);
      const url = new URL(this.endpoint);
      url.searchParams.set("latitude", chunk.map((region) => region.latitude).join(","));
      url.searchParams.set("longitude", chunk.map((region) => region.longitude).join(","));
      url.searchParams.set("hourly", "sea_surface_temperature");
      url.searchParams.set("past_days", "7");
      url.searchParams.set("forecast_days", "1");
      url.searchParams.set("timezone", "UTC");
      url.searchParams.set("cell_selection", "sea");
      if (this.apiKey) url.searchParams.set("apikey", this.apiKey);
      const { text } = await fetchText(url.toString(), {
        fetcher: this.fetcher,
        attempts: 2,
        timeoutMs: 30_000,
      });
      const parsed = JSON.parse(text) as MarineLocation | MarineLocation[];
      const locations = Array.isArray(parsed) ? parsed : [parsed];
      if (locations.length !== chunk.length)
        throw new Error("Open-Meteo Marine location count mismatch");
      locations.forEach((location, locationIndex) => {
        const region = chunk[locationIndex];
        if (!location.hourly) return;
        const warming = detectSstWarming(location.hourly, now);
        if (!warming) return;
        const id = `open-meteo-marine:${region.id}:sst-warming`;
        output.push({
          schemaVersion: 1,
          id,
          category: "climate",
          type: "water_anomaly",
          title: `Rapid sea-surface warming · +${warming.deltaC.toFixed(1)}°C / 7d`,
          description: `${region.name} sentinel shows modelled sea-surface temperature rising from ${warming.baselineC.toFixed(1)}°C to ${warming.currentC.toFixed(1)}°C across comparable six-hour windows approximately seven days apart. This is a rapid-change sentinel, not a climatological marine-heatwave classification.`,
          status: "active",
          severity: warming.severity,
          confidence: 0.5,
          startedAt: warming.startedAt,
          updatedAt: warming.updatedAt,
          endedAt: null,
          location: {
            latitude: region.latitude,
            longitude: region.longitude,
            geometryType: "point",
          },
          magnitude: {
            value: warming.deltaC,
            unit: "°C / 7d",
            description: "Change between six-hour mean SST windows separated by approximately seven days",
          },
          source: {
            provider: this.id,
            name: "Open-Meteo Marine",
            url: "https://open-meteo.com/en/docs/marine-weather-api",
            upstreamId: id,
          },
          secondarySources: [],
          properties: {
            modelled: true,
            marineHeatwave: false,
            sentinelNetwork: "ocean-basins-v1",
            region: region.name,
            currentSstC: warming.currentC,
            baselineSstC: warming.baselineC,
            sstChange7dC: warming.deltaC,
            collectedAt: now.toISOString(),
            thresholdMethod: "sst-rapid-warming-v1",
          },
        });
      });
    }
    const limit = Math.max(1, Math.min(1000, options.limit ?? 1000));
    const rank = { significant: 3, elevated: 2, notable: 1, info: 0 } as const;
    return output
      .sort((a, b) => rank[b.severity] - rank[a.severity] || (b.magnitude.value ?? 0) - (a.magnitude.value ?? 0))
      .slice(0, limit);
  }
}
