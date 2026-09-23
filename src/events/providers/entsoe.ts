import { fetchText } from "../../providers/http";
import type { WorldEvent } from "../types";

type EntsoeZone = {
  id: string;
  name: string;
  eic: string;
  latitude: number;
  longitude: number;
};

type Options = {
  fetcher?: typeof fetch;
  endpoint?: string;
  token: string;
  zones?: readonly EntsoeZone[];
};

export const ENTSOE_SENTINELS: readonly EntsoeZone[] = [
  { id: "fr", name: "France", eic: "10YFR-RTE------C", latitude: 46.2, longitude: 2.2 },
  { id: "be", name: "Belgium", eic: "10YBE----------2", latitude: 50.5, longitude: 4.5 },
  { id: "nl", name: "Netherlands", eic: "10YNL----------L", latitude: 52.2, longitude: 5.3 },
  { id: "de-lu", name: "Germany / Luxembourg", eic: "10Y1001A1001A82H", latitude: 51.1, longitude: 10.4 },
  { id: "es", name: "Spain", eic: "10YES-REE------0", latitude: 40.4, longitude: -3.7 },
  { id: "it", name: "Italy", eic: "10YIT-GRTN-----B", latitude: 42.8, longitude: 12.8 },
];

function formatPeriod(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").slice(0, 12);
}

function tag(block: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(
    new RegExp(`<(?:(?:\\w+):)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${escaped}>`, "i"),
  );
  return match?.[1]?.trim() ?? null;
}

function cleanText(value: string | null) {
  return value
    ?.replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim() ?? null;
}

function parseIso(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function parseEntsoeUnavailability(
  xml: string,
  zone: EntsoeZone,
  now = new Date(),
): WorldEvent[] {
  const blocks = xml.match(/<(?:(?:\w+):)?TimeSeries\b[\s\S]*?<\/(?:(?:\w+):)?TimeSeries>/gi) ?? [];
  const events: WorldEvent[] = [];
  for (const block of blocks) {
    const businessType = tag(block, "businessType");
    if (businessType && businessType !== "A54") continue;
    const upstreamId = tag(block, "mRID");
    if (!upstreamId) continue;
    const start =
      parseIso(tag(block, "start")) ??
      parseIso(
        tag(block, "start_DateAndOrTime.date") && tag(block, "start_DateAndOrTime.time")
          ? `${tag(block, "start_DateAndOrTime.date")}T${tag(block, "start_DateAndOrTime.time")}`
          : null,
      );
    const end =
      parseIso(tag(block, "end")) ??
      parseIso(
        tag(block, "end_DateAndOrTime.date") && tag(block, "end_DateAndOrTime.time")
          ? `${tag(block, "end_DateAndOrTime.date")}T${tag(block, "end_DateAndOrTime.time")}`
          : null,
      );
    if (!start || !end) continue;
    if (Date.parse(end) < now.getTime() - 6 * 3_600_000) continue;
    const resource =
      cleanText(tag(block, "production_RegisteredResource.name")) ??
      cleanText(tag(block, "name"));
    const reason = cleanText(tag(block, "text"));
    const active = Date.parse(end) > now.getTime();
    const id = `entsoe:${zone.id}:${upstreamId}`;
    events.push({
      schemaVersion: 1,
      id,
      category: "infrastructure",
      type: "power_grid_disruption",
      title: `Forced power-system unavailability · ${zone.name}`,
      description: [
        resource ? `Affected resource: ${resource}.` : null,
        reason ? `ENTSO-E reason: ${reason}.` : null,
        "This is a forced generation/infrastructure unavailability signal and does not by itself prove a customer electricity outage.",
      ]
        .filter(Boolean)
        .join(" "),
      status: active ? "active" : "resolved",
      severity: "notable",
      confidence: 0.75,
      startedAt: start,
      updatedAt: active ? start : end,
      endedAt: active ? null : end,
      location: {
        latitude: zone.latitude,
        longitude: zone.longitude,
        geometryType: "point",
      },
      magnitude: {
        value: null,
        unit: null,
        description: "ENTSO-E forced unavailability; capacity is intentionally not inferred from incomplete XML fields",
      },
      source: {
        provider: "entsoe",
        name: "ENTSO-E Transparency Platform",
        url: "https://transparency.entsoe.eu/",
        upstreamId,
      },
      secondarySources: [],
      properties: {
        zone: zone.name,
        eic: zone.eic,
        forcedUnavailability: true,
        customerOutageConfirmed: false,
        collectedAt: now.toISOString(),
      },
    });
  }
  return events;
}

export class EntsoePowerProvider {
  readonly id = "entsoe";
  readonly name = "ENTSO-E Transparency Platform";
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;
  private readonly token: string;
  private readonly zones: readonly EntsoeZone[];

  constructor(options: Options) {
    this.fetcher = options.fetcher ?? fetch;
    this.endpoint = options.endpoint ?? "https://web-api.tp.entsoe.eu/api";
    this.token = options.token;
    this.zones = options.zones ?? ENTSOE_SENTINELS;
  }

  async fetchEvents(options: { now?: Date; limit?: number } = {}): Promise<WorldEvent[]> {
    const now = options.now ?? new Date();
    const start = new Date(now.getTime() - 6 * 3_600_000);
    const end = new Date(now.getTime() + 24 * 3_600_000);
    const events: WorldEvent[] = [];
    for (const zone of this.zones) {
      const url = new URL(this.endpoint);
      url.searchParams.set("securityToken", this.token);
      url.searchParams.set("documentType", "A80");
      url.searchParams.set("businessType", "A54");
      url.searchParams.set("biddingZone_Domain", zone.eic);
      url.searchParams.set("periodStart", formatPeriod(start));
      url.searchParams.set("periodEnd", formatPeriod(end));
      const { text } = await fetchText(url.toString(), {
        fetcher: this.fetcher,
        attempts: 2,
        timeoutMs: 30_000,
      });
      events.push(...parseEntsoeUnavailability(text, zone, now));
    }
    const limit = Math.max(1, Math.min(500, options.limit ?? 500));
    return events
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, limit);
  }
}
