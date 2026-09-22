import type { WorldSignal, SignalType } from "../../core/types";
import type { CorrelatedEvent } from "../../correlations/types";
import type { ContextEvidence, ContextProvider } from "../evidence";

const DEFAULT_ENDPOINT = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH";
const MAX_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const PRE_WINDOW_MS = 60 * 60 * 1000;

const EVENT_CODES: Partial<Record<SignalType, string>> = {
  earthquake: "EQ",
  wildfire: "WF",
};

export interface GdacsContextProviderOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  now?: () => Date;
}

type GdacsFeature = {
  properties?: Record<string, unknown>;
};

type GdacsPayload = {
  features?: unknown;
};

function signalTypes(event: WorldSignal | CorrelatedEvent): SignalType[] {
  return "signalIds" in event ? event.signalTypes : [event.type];
}

function eventStart(event: WorldSignal | CorrelatedEvent) {
  return Date.parse("signalIds" in event ? event.startedAt : (event.startedAt ?? event.timestamp));
}

function eventEnd(event: WorldSignal | CorrelatedEvent) {
  return Date.parse(
    "signalIds" in event
      ? event.windowEnd
      : (event.evidence?.windowEnd ?? event.timestamp),
  );
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function property(properties: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (key in properties) return properties[key];
    const matched = Object.keys(properties).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (matched) return properties[matched];
  }
  return undefined;
}

function normalizeFeature(feature: GdacsFeature, retrievedAt: string, index: number): ContextEvidence | null {
  const properties = feature.properties;
  if (!properties || typeof properties !== "object") return null;

  const eventType = asString(property(properties, "eventtype", "eventType", "type"));
  const eventId = asId(property(properties, "eventid", "eventId", "id"));
  if (!eventType || !eventId) return null;

  const publishedAt = parseDate(property(properties, "fromdate", "fromDate", "date", "episodeDate"));
  if (!publishedAt) return null;

  const country = asString(property(properties, "country", "countryname", "countryName"));
  const name = asString(property(properties, "name", "eventname", "eventName", "title"));
  const description = asString(property(properties, "description", "eventdescription", "eventDescription"));
  const alertLevel = asString(property(properties, "alertlevel", "alertLevel"));
  const episodeId = asId(property(properties, "episodeid", "episodeId"));

  const typeLabel = eventType.toUpperCase() === "EQ"
    ? "earthquake"
    : eventType.toUpperCase() === "WF"
      ? "wildfire"
      : eventType.toLowerCase();

  const url = new URL("https://www.gdacs.org/resources.aspx");
  url.searchParams.set("eventtype", eventType.toUpperCase());
  url.searchParams.set("eventid", eventId);
  if (episodeId) url.searchParams.set("episodeid", episodeId);

  const text = [
    name,
    `${typeLabel} alert`,
    country,
    alertLevel ? `GDACS ${alertLevel} alert` : null,
    description,
  ].filter((value): value is string => Boolean(value)).join(" · ");

  if (!text) return null;

  return {
    id: `gdacs:${eventType.toUpperCase()}:${eventId}:${episodeId ?? index}`,
    source: { name: "GDACS · UN / European Commission", url: url.toString() },
    publishedAt,
    retrievedAt,
    text,
  };
}

export class GdacsContextProvider implements ContextProvider {
  readonly id = "gdacs-official";
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly now: () => Date;

  constructor(options: GdacsContextProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.now = options.now ?? (() => new Date());
  }

  async searchContext(event: WorldSignal | CorrelatedEvent): Promise<ContextEvidence[]> {
    const eventCodes = [...new Set(signalTypes(event).map((type) => EVENT_CODES[type]).filter((code): code is string => Boolean(code)))];
    if (!eventCodes.length) return [];

    const startMs = eventStart(event);
    const endMs = eventEnd(event);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

    const nowMs = this.now().getTime();
    const from = new Date(Math.max(0, startMs - PRE_WINDOW_MS));
    const to = new Date(Math.min(nowMs, Math.max(startMs, endMs) + MAX_LOOKAHEAD_MS));
    if (to.getTime() <= from.getTime()) return [];

    const url = new URL(this.endpoint);
    url.searchParams.set("eventlist", eventCodes.join(";"));
    url.searchParams.set("fromdate", isoDate(from));
    url.searchParams.set("todate", isoDate(to));
    url.searchParams.set("alertlevel", "red;orange;green");

    const response = await this.fetchImpl(url, {
      headers: { accept: "application/geo+json, application/json", "user-agent": "WORLD-SIGNAL/0.2 context-engine" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`GDACS context request failed: ${response.status}`);

    const payload = await response.json() as GdacsPayload | GdacsFeature[];
    const rawFeatures = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.features)
        ? payload.features
        : [];
    const retrievedAt = this.now().toISOString();
    return rawFeatures
      .map((feature, index) => normalizeFeature(feature as GdacsFeature, retrievedAt, index))
      .filter((item): item is ContextEvidence => item !== null);
  }
}
