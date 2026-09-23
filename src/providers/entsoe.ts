import { fetchText } from "./http";

export interface EntsoeRegion {
  id: string;
  name: string;
  eic: string;
  latitude: number;
  longitude: number;
}

export interface PowerLoadObservation {
  region: EntsoeRegion;
  timestamp: string;
  loadMw: number;
}

export const ENTSOE_REGIONS: readonly EntsoeRegion[] = [
  { id: "france", name: "France", eic: "10YFR-RTE------C", latitude: 46.6, longitude: 2.4 },
  { id: "germany-lux", name: "Germany–Luxembourg", eic: "10Y1001A1001A82H", latitude: 51.1, longitude: 10.4 },
  { id: "belgium", name: "Belgium", eic: "10YBE----------2", latitude: 50.6, longitude: 4.7 },
  { id: "netherlands", name: "Netherlands", eic: "10YNL----------L", latitude: 52.2, longitude: 5.3 },
  { id: "spain", name: "Spain", eic: "10YES-REE------0", latitude: 40.4, longitude: -3.7 },
  { id: "poland", name: "Poland", eic: "10YPL-AREA-----S", latitude: 52.1, longitude: 19.4 },
];

type Options = {
  fetcher?: typeof fetch;
  endpoint?: string;
  token: string;
  regions?: readonly EntsoeRegion[];
};

function durationMs(value: string) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(value.trim());
  if (!match) return null;
  return (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000;
}

function tag(block: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<${escaped}[^>]*>([^<]+)</${escaped}>`, "i").exec(block)?.[1]?.trim() ?? null;
}

export function parseEntsoeActualLoad(xml: string): { timestamp: string; loadMw: number } | null {
  if (/Acknowledgement_MarketDocument/i.test(xml)) return null;
  const values = new Map<number, number>();
  const periods = xml.match(/<Period>[\s\S]*?<\/Period>/gi) ?? [];
  for (const period of periods) {
    const interval = /<timeInterval>[\s\S]*?<start>([^<]+)<\/start>[\s\S]*?<\/timeInterval>/i.exec(period);
    const resolution = tag(period, "resolution");
    if (!interval || !resolution) continue;
    const start = Date.parse(interval[1]);
    const step = durationMs(resolution);
    if (!Number.isFinite(start) || !step) continue;
    const points = period.match(/<Point>[\s\S]*?<\/Point>/gi) ?? [];
    for (const point of points) {
      const position = Number(tag(point, "position"));
      const quantity = Number(tag(point, "quantity"));
      if (!Number.isFinite(position) || position < 1 || !Number.isFinite(quantity) || quantity < 0)
        continue;
      const timestamp = start + (position - 1) * step;
      values.set(timestamp, (values.get(timestamp) ?? 0) + quantity);
    }
  }
  if (!values.size) return null;
  const timestamp = Math.max(...values.keys());
  return {
    timestamp: new Date(timestamp).toISOString(),
    loadMw: Number((values.get(timestamp) ?? 0).toFixed(2)),
  };
}

function utcStamp(date: Date) {
  return date.toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

export class EntsoeActualLoadProvider {
  readonly id = "entsoe";
  readonly name = "ENTSO-E Transparency Platform";
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;
  private readonly token: string;
  private readonly regions: readonly EntsoeRegion[];

  constructor(options: Options) {
    if (!options.token) throw new Error("ENTSOE_SECURITY_TOKEN is required");
    this.fetcher = options.fetcher ?? fetch;
    this.endpoint = options.endpoint ?? "https://web-api.tp.entsoe.eu/api";
    this.token = options.token;
    this.regions = options.regions ?? ENTSOE_REGIONS;
  }

  async fetchLoads(now = new Date()): Promise<{ observations: PowerLoadObservation[]; failedRegions: string[] }> {
    const from = new Date(now.getTime() - 6 * 3_600_000);
    const observations: PowerLoadObservation[] = [];
    const failedRegions: string[] = [];
    for (const region of this.regions) {
      try {
        const url = new URL(this.endpoint);
        url.searchParams.set("securityToken", this.token);
        url.searchParams.set("documentType", "A65");
        url.searchParams.set("processType", "A16");
        url.searchParams.set("outBiddingZone_Domain", region.eic);
        url.searchParams.set("periodStart", utcStamp(from));
        url.searchParams.set("periodEnd", utcStamp(now));
        const { text } = await fetchText(url.toString(), {
          fetcher: this.fetcher,
          attempts: 2,
          timeoutMs: 20_000,
        });
        const parsed = parseEntsoeActualLoad(text);
        if (!parsed) {
          failedRegions.push(region.id);
          continue;
        }
        observations.push({ region, ...parsed });
      } catch {
        failedRegions.push(region.id);
      }
    }
    return { observations, failedRegions };
  }
}
