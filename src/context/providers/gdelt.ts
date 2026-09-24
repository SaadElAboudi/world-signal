import { createBudgetedFetch } from "../../server/budgeted-fetch";
import type { WorldSignal, SignalType } from "../../core/types";
import type { CorrelatedEvent } from "../../correlations/types";
import type { ContextEvidence, ContextProvider } from "../evidence";

const DEFAULT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const MAX_WINDOW_MS = 12 * 60 * 60 * 1000;
const PRE_WINDOW_MS = 30 * 60 * 1000;

export interface GdeltContextProviderOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  maxRecords?: number;
  now?: () => Date;
}

type GdeltArticle = {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  domain?: unknown;
  sourcecountry?: unknown;
  language?: unknown;
};

const SIGNAL_TERMS: Record<SignalType, string[]> = {
  earthquake: ["earthquake", "seismic", "tremor"],
  wildfire: ["wildfire", "fire", "blaze"],
  internet: ["internet outage", "connectivity", "network outage"],
  aviation: ["aviation", "airport", "flight disruption"],
};

function signalTypes(event: WorldSignal | CorrelatedEvent): SignalType[] {
  return "signalIds" in event ? event.signalTypes : [event.type];
}

function locationTerms(event: WorldSignal | CorrelatedEvent) {
  if ("signalIds" in event) {
    return [event.geographicScope.country].filter((value): value is string => Boolean(value));
  }
  return [event.region, event.country].filter((value): value is string => Boolean(value));
}

function quote(value: string) {
  return `"${value.replace(/"/g, "").trim()}"`;
}

export function buildGdeltQuery(event: WorldSignal | CorrelatedEvent) {
  const places = locationTerms(event).map(quote);
  const topics = [...new Set(signalTypes(event).flatMap((type) => SIGNAL_TERMS[type]))]
    .map((term) => quote(term));
  const placeClause = places.length > 1 ? `(${places.join(" OR ")})` : (places[0] ?? "");
  const topicClause = topics.length > 1 ? `(${topics.join(" OR ")})` : (topics[0] ?? "");
  return [placeClause, topicClause].filter(Boolean).join(" ");
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

function gdeltDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}

function parseSeenDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const [, year, month, day, hour, minute, second] = match;
  const parsed = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function articleEvidence(article: GdeltArticle, retrievedAt: string, index: number): ContextEvidence | null {
  if (typeof article.url !== "string" || typeof article.title !== "string") return null;
  const publishedAt = parseSeenDate(article.seendate);
  if (!publishedAt) return null;
  let url: URL;
  try {
    url = new URL(article.url);
  } catch {
    return null;
  }
  const sourceName = typeof article.domain === "string" && article.domain.trim()
    ? article.domain.trim()
    : url.hostname;
  const metadata = [
    article.title.trim(),
    typeof article.sourcecountry === "string" ? article.sourcecountry.trim() : "",
  ].filter(Boolean).join(" · ");
  return {
    id: `gdelt:${publishedAt}:${index}:${url.hostname}`,
    source: { name: sourceName, url: url.toString() },
    publishedAt,
    retrievedAt,
    text: metadata,
  };
}

export class GdeltContextProvider implements ContextProvider {
  readonly id = "gdelt-doc";
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly maxRecords: number;
  private readonly now: () => Date;

  constructor(options: GdeltContextProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? createBudgetedFetch("context");
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.maxRecords = Math.max(1, Math.min(50, options.maxRecords ?? 25));
    this.now = options.now ?? (() => new Date());
  }

  async searchContext(event: WorldSignal | CorrelatedEvent): Promise<ContextEvidence[]> {
    const startMs = eventStart(event);
    const endMs = eventEnd(event);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

    const nowMs = this.now().getTime();
    const start = new Date(Math.max(startMs - PRE_WINDOW_MS, nowMs - 90 * 24 * 60 * 60 * 1000));
    const end = new Date(Math.min(nowMs, Math.max(endMs, startMs) + MAX_WINDOW_MS));
    if (end.getTime() <= start.getTime()) return [];

    const query = buildGdeltQuery(event);
    if (!query) return [];

    const url = new URL(this.endpoint);
    url.searchParams.set("query", query);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "datedesc");
    url.searchParams.set("maxrecords", String(this.maxRecords));
    url.searchParams.set("startdatetime", gdeltDate(start));
    url.searchParams.set("enddatetime", gdeltDate(end));

    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "WORLD-SIGNAL/0.2 context-engine" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`GDELT context request failed: ${response.status}`);
    const payload = await response.json() as { articles?: unknown };
    if (!Array.isArray(payload.articles)) return [];
    const retrievedAt = this.now().toISOString();
    return payload.articles
      .map((article, index) => articleEvidence(article as GdeltArticle, retrievedAt, index))
      .filter((item): item is ContextEvidence => item !== null);
  }
}
