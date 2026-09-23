import { fetchText } from "../../providers/http";
import type { EventSeverity, WorldEvent } from "../types";

export interface EntsoeZone {
  id: string;
  name: string;
  eic: string;
  latitude: number;
  longitude: number;
}

export const ENTSOE_ZONES: readonly EntsoeZone[] = [
  { id: "fr", name: "France", eic: "10YFR-RTE------C", latitude: 46.5, longitude: 2.2 },
  { id: "de-lu", name: "Germany / Luxembourg", eic: "10Y1001A1001A82H", latitude: 51.0, longitude: 10.0 },
  { id: "es", name: "Spain", eic: "10YES-REE------0", latitude: 40.4, longitude: -3.7 },
  { id: "it", name: "Italy", eic: "10YIT-GRTN-----B", latitude: 42.5, longitude: 12.5 },
  { id: "nl", name: "Netherlands", eic: "10YNL----------L", latitude: 52.1, longitude: 5.3 },
  { id: "be", name: "Belgium", eic: "10YBE----------2", latitude: 50.8, longitude: 4.4 },
  { id: "pl", name: "Poland", eic: "10YPL-AREA-----S", latitude: 52.0, longitude: 19.0 },
] as const;

type Point = { timestamp: number; quantityMw: number };

type Options = {
  token: string;
  fetcher?: typeof fetch;
  endpoint?: string;
  zones?: readonly EntsoeZone[];
  maxZonesPerRun?: number;
};

function parseDurationMs(value: string) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(value.trim());
  if (!match) return null;
  return (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000;
}

function tag(block: string, name: string) {
  const expression = new RegExp(`<${name}>([^<]+)</${name}>`);
  return expression.exec(block)?.[1]?.trim() ?? null;
}

export function parseEntsoeSeries(xml: string): Point[] {
  const periods = [...xml.matchAll(/<Period>([\s\S]*?)<\/Period>/g)];
  const points: Point[] = [];
  for (const periodMatch of periods) {
    const period = periodMatch[1];
    const interval = /<timeInterval>([\s\S]*?)<\/timeInterval>/.exec(period)?.[1] ?? "";
    const startRaw = tag(interval, "start");
    const resolutionRaw = tag(period, "resolution");
    if (!startRaw || !resolutionRaw) continue;
    const start = Date.parse(startRaw);
    const step = parseDurationMs(resolutionRaw);
    if (!Number.isFinite(start) || !step) continue;
    for (const pointMatch of period.matchAll(/<Point>([\s\S]*?)<\/Point>/g)) {
      const point = pointMatch[1];
      const position = Number(tag(point, "position"));
      const quantity = Number(tag(point, "quantity"));
      if (!Number.isInteger(position) || position < 1 || !Number.isFinite(quantity)) continue;
      points.push({
        timestamp: start + (position - 1) * step,
        quantityMw: quantity,
      });
    }
  }
  return points.sort((a, b) => a.timestamp - b.timestamp);
}

function severity(shortfallRatio: number): EventSeverity | null {
  if (shortfallRatio >= 0.4) return "significant";
  if (shortfallRatio >= 0.25) return "elevated";
  if (shortfallRatio >= 0.15) return "notable";
  return null;
}

function utcStamp(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}`;
}

function nearestForecast(actual: Point, forecast: Point[]) {
  let best: Point | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of forecast) {
    const candidate = Math.abs(point.timestamp - actual.timestamp);
    if (candidate < distance) {
      distance = candidate;
      best = point;
    }
  }
  return distance <= 30 * 60_000 ? best : null;
}

export class EntsoeGridLoadProvider {
  readonly id = "entsoe";
  readonly name = "ENTSO-E Transparency Platform";
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;
  private readonly zones: readonly EntsoeZone[];

  constructor(options: Options) {
    this.token = options.token;
    this.fetcher = options.fetcher ?? fetch;
    this.endpoint = options.endpoint ?? "https://web-api.tp.entsoe.eu/api";
    const max = Math.max(1, Math.min(options.zones?.length ?? ENTSOE_ZONES.length, Math.floor(options.maxZonesPerRun ?? 7)));
    this.zones = (options.zones ?? ENTSOE_ZONES).slice(0, max);
  }

  private async load(zone: EntsoeZone, processType: "A16" | "A01", start: Date, end: Date) {
    const url = new URL(this.endpoint);
    url.searchParams.set("securityToken", this.token);
    url.searchParams.set("documentType", "A65");
    url.searchParams.set("processType", processType);
    url.searchParams.set("outBiddingZone_Domain", zone.eic);
    url.searchParams.set("periodStart", utcStamp(start));
    url.searchParams.set("periodEnd", utcStamp(end));
    const { text } = await fetchText(url.toString(), {
      fetcher: this.fetcher,
      attempts: 2,
      timeoutMs: 20_000,
    });
    return parseEntsoeSeries(text);
  }

  async fetchEvents(options: { now?: Date; limit?: number } = {}): Promise<WorldEvent[]> {
    const now = options.now ?? new Date();
    const start = new Date(now.getTime() - 6 * 60 * 60_000);
    const end = new Date(now.getTime() + 60 * 60_000);
    const events: WorldEvent[] = [];
    let successfulZones = 0;
    let failedZones = 0;

    for (const zone of this.zones) {
      try {
        const [actual, forecast] = await Promise.all([
          this.load(zone, "A16", start, end),
          this.load(zone, "A01", start, end),
        ]);
        successfulZones++;
        const eligible = actual.filter((point) => point.timestamp <= now.getTime());
        const current = eligible.at(-1);
        if (!current) continue;
        const expected = nearestForecast(current, forecast);
        if (!expected || expected.quantityMw < 500) continue;
        const ratio = 1 - current.quantityMw / expected.quantityMw;
        const level = severity(ratio);
        if (!level) continue;
        const percent = Number((ratio * 100).toFixed(1));
        const timestamp = new Date(current.timestamp).toISOString();
        const bucket = timestamp.slice(0, 13);
        const id = `entsoe:${zone.id}:load-shortfall:${bucket}`;
        events.push({
          schemaVersion: 1,
          id,
          category: "infrastructure",
          type: "grid_load_anomaly",
          title: `${zone.name} grid load ${percent.toFixed(1)}% below day-ahead forecast`,
          description: `ENTSO-E reports ${Math.round(current.quantityMw).toLocaleString("en-US")} MW actual total load versus ${Math.round(expected.quantityMw).toLocaleString("en-US")} MW day-ahead forecast. This is a grid-load anomaly sentinel, not confirmation of a power outage.`,
          status: "active",
          severity: level,
          confidence: 0.55,
          startedAt: timestamp,
          updatedAt: now.toISOString(),
          endedAt: null,
          location: {
            latitude: zone.latitude,
            longitude: zone.longitude,
            geometryType: "point",
          },
          magnitude: {
            value: percent,
            unit: "% below forecast",
            description: "Actual total load shortfall relative to the matching day-ahead forecast",
          },
          source: {
            provider: this.id,
            name: this.name,
            url: "https://transparency.entsoe.eu/",
            upstreamId: id,
          },
          secondarySources: [],
          properties: {
            zone: zone.name,
            eic: zone.eic,
            actualLoadMw: Number(current.quantityMw.toFixed(1)),
            forecastLoadMw: Number(expected.quantityMw.toFixed(1)),
            shortfallPercent: percent,
            notConfirmedOutage: true,
            thresholdMethod: "actual-vs-day-ahead-load-v1",
            requestBudgetPerRun: this.zones.length * 2,
          },
        });
      } catch {
        failedZones++;
      }
    }

    if (!successfulZones && failedZones) throw new Error("ENTSO-E unavailable for all configured zones");
    const limit = Math.max(1, Math.min(100, options.limit ?? 100));
    return events.slice(0, limit);
  }
}
