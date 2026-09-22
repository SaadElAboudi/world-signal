import type { WorldSignal, SignalType } from "../core/types";
import type { CorrelatedEvent } from "../correlations/types";
import type { ContextEvidence, ContextProvider } from "./evidence";

export type InvestigationStatus =
  | "no_explanation_found_yet"
  | "context_found"
  | "context_unavailable";
export type ContextRetrievalStatus = "not_attempted" | "complete" | "partial" | "unavailable";
export type ExplanationConfidenceLevel = "none" | "low" | "moderate" | "strong";

type InvestigationLocation = {
  country: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
};

export interface ContextProviderResult {
  providerId: string;
  status: "ok" | "error";
  evidenceCount: number;
  error?: string;
}

export interface RankedContextEvidence extends ContextEvidence {
  score: number;
  scoreBreakdown: {
    temporal: number;
    geographic: number;
    topical: number;
    source: number;
  };
  matchedTerms: string[];
  matchedLocationTerms: string[];
  matchedTopicTerms: string[];
}

export interface ExplanationConfidence {
  score: number;
  level: ExplanationConfidenceLevel;
  rationale: string;
}

export interface InvestigationTimelineEntry {
  timestamp: string;
  kind: "signal" | "context";
  label: string;
  signalId?: string;
  evidenceId?: string;
  sourceName?: string;
}

export interface Investigation {
  schemaVersion: 1;
  id: string;
  eventId: string;
  createdAt: string;
  window: { start: string; end: string };
  location: InvestigationLocation;
  status: InvestigationStatus;
  retrievalStatus: ContextRetrievalStatus;
  providers: ContextProviderResult[];
  evidence: RankedContextEvidence[];
  explanationConfidence: ExplanationConfidence;
  timeline: InvestigationTimelineEntry[];
  unknowns: string[];
}

export interface BuildInvestigationOptions {
  providers: ContextProvider[];
  signals?: WorldSignal[];
  now?: Date;
  maxEvidence?: number;
}

const TOPIC_TERMS: Record<SignalType, string[]> = {
  earthquake: ["earthquake", "seismic", "tremor", "quake"],
  wildfire: ["wildfire", "forest fire", "brush fire", "blaze", "fire"],
  internet: ["internet outage", "network outage", "connectivity", "telecom outage", "internet disruption"],
  aviation: ["aviation", "airport", "flight disruption", "flight cancellation", "airspace"],
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function eventTypes(event: WorldSignal | CorrelatedEvent): SignalType[] {
  return "signalIds" in event ? event.signalTypes : [event.type];
}

function sourceTrust(source: ContextEvidence["source"]) {
  const normalized = `${source.name} ${source.url}`.toLowerCase();
  if (/(\.gov\b|\.gov\.|\.gouv\.fr\b|government|official|authority|agency|ministry|prefecture|police|fire brigade|usgs|nasa)/.test(normalized)) return 1;
  if (/(reuters|associated press|\bap\b|afp|bbc|guardian|nytimes|new york times|le monde|franceinfo)/.test(normalized)) return 0.9;
  return 0.4;
}

function eventWindow(event: WorldSignal | CorrelatedEvent) {
  return "signalIds" in event
    ? { start: event.startedAt, end: event.windowEnd }
    : { start: event.startedAt ?? event.timestamp, end: event.evidence?.windowEnd ?? event.timestamp };
}

function eventLocation(event: WorldSignal | CorrelatedEvent): InvestigationLocation {
  return "signalIds" in event
    ? {
        country: event.geographicScope.country,
        region: null,
        latitude: event.geographicScope.latitude,
        longitude: event.geographicScope.longitude,
      }
    : {
        country: event.country,
        region: event.region,
        latitude: event.latitude,
        longitude: event.longitude,
      };
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenise(value: string | null | undefined) {
  return normalizeText(value).split(/\s+/).filter((token) => token.length >= 3);
}

function matchesPhrase(haystack: string, phrase: string) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  return ` ${haystack} `.includes(` ${normalizedPhrase} `);
}

function scoreEvidence(event: WorldSignal | CorrelatedEvent, evidence: ContextEvidence): RankedContextEvidence {
  const window = eventWindow(event);
  const location = eventLocation(event);
  const eventStart = Date.parse(window.start);
  const published = Date.parse(evidence.publishedAt);
  const deltaMinutes = Number.isFinite(eventStart) && Number.isFinite(published)
    ? Math.abs(published - eventStart) / 60000
    : Number.POSITIVE_INFINITY;
  const temporal = clamp(1 - deltaMinutes / (12 * 60));

  const normalizedEvidence = normalizeText(evidence.text);
  const evidenceTokens = new Set(tokenise(evidence.text));
  const locationTokens = [...new Set([...tokenise(location.country), ...tokenise(location.region)])];
  const matchedLocationTerms = locationTokens.filter((token) => evidenceTokens.has(token));
  const geographic = locationTokens.length
    ? clamp(matchedLocationTerms.length / locationTokens.length)
    : 0.5;

  const topicTerms = [...new Set(eventTypes(event).flatMap((type) => TOPIC_TERMS[type]))];
  const matchedTopicTerms = topicTerms.filter((term) => matchesPhrase(normalizedEvidence, term));
  const topical = matchedTopicTerms.length > 0 ? 1 : 0;
  const source = sourceTrust(evidence.source);
  const score = Number((temporal * 0.35 + geographic * 0.25 + topical * 0.25 + source * 0.15).toFixed(4));

  return {
    ...evidence,
    score,
    scoreBreakdown: {
      temporal: Number(temporal.toFixed(4)),
      geographic: Number(geographic.toFixed(4)),
      topical,
      source: Number(source.toFixed(4)),
    },
    matchedTerms: [...matchedLocationTerms, ...matchedTopicTerms],
    matchedLocationTerms,
    matchedTopicTerms,
  };
}

function signalTimeline(event: WorldSignal | CorrelatedEvent, signals: WorldSignal[]) {
  const ids = "signalIds" in event ? new Set(event.signalIds) : new Set([event.id]);
  const members = signals.filter((signal) => ids.has(signal.id));
  const fallback: WorldSignal[] = "signalIds" in event ? [] : [event];
  return (members.length ? members : fallback).map<InvestigationTimelineEntry>((signal) => ({
    timestamp: signal.startedAt ?? signal.timestamp,
    kind: "signal",
    label: `${signal.type} anomaly detected`,
    signalId: signal.id,
  }));
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 160) : "provider_error";
}

function canonicalEvidenceUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function buildExplanationConfidence(evidence: RankedContextEvidence[]): ExplanationConfidence {
  if (!evidence.length) {
    return {
      score: 0,
      level: "none",
      rationale: "No sufficiently relevant external evidence was retrieved.",
    };
  }

  const strongest = evidence.slice(0, 3);
  const relevance = strongest.reduce((sum, item) => sum + item.score, 0) / strongest.length;
  const domains = new Set(
    strongest.map((item) => {
      try {
        return new URL(item.source.url).hostname.toLowerCase();
      } catch {
        return item.source.name.toLowerCase();
      }
    }),
  );
  const diversity = clamp(domains.size / 2);
  const volume = clamp(strongest.length / 3);
  const score = Number((relevance * 0.65 + diversity * 0.2 + volume * 0.15).toFixed(4));
  const level: ExplanationConfidenceLevel = score >= 0.85
    ? "strong"
    : score >= 0.65
      ? "moderate"
      : "low";

  return {
    score,
    level,
    rationale: `${strongest.length} relevant evidence item${strongest.length === 1 ? "" : "s"} across ${domains.size} independent source domain${domains.size === 1 ? "" : "s"}. This measures contextual support, not causality or incident probability.`,
  };
}

export async function buildInvestigation(
  event: WorldSignal | CorrelatedEvent,
  options: BuildInvestigationOptions,
): Promise<Investigation> {
  const now = options.now ?? new Date();
  const maxEvidence = options.maxEvidence ?? 12;
  const settled = await Promise.allSettled(
    options.providers.map((provider) => provider.searchContext(event)),
  );
  const providers: ContextProviderResult[] = settled.map((result, index) => ({
    providerId: options.providers[index]?.id ?? `provider-${index}`,
    status: result.status === "fulfilled" ? "ok" : "error",
    evidenceCount: result.status === "fulfilled" ? result.value.length : 0,
    ...(result.status === "rejected" ? { error: safeError(result.reason) } : {}),
  }));
  const successful = providers.filter((provider) => provider.status === "ok").length;
  const retrievalStatus: ContextRetrievalStatus = options.providers.length === 0
    ? "not_attempted"
    : successful === options.providers.length
      ? "complete"
      : successful === 0
        ? "unavailable"
        : "partial";

  const byUrl = new Map<string, ContextEvidence>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      if (!item.source?.url || !item.publishedAt || !item.text) continue;
      const canonicalUrl = canonicalEvidenceUrl(item.source.url);
      if (!canonicalUrl) continue;
      const normalizedItem = {
        ...item,
        source: { ...item.source, url: canonicalUrl },
      };
      const existing = byUrl.get(canonicalUrl);
      if (!existing || Date.parse(item.retrievedAt) > Date.parse(existing.retrievedAt)) {
        byUrl.set(canonicalUrl, normalizedItem);
      }
    }
  }

  const evidence = [...byUrl.values()]
    .map((item) => scoreEvidence(event, item))
    .filter((item) => item.score >= 0.45 && item.scoreBreakdown.topical > 0)
    .sort((a, b) => b.score - a.score || Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
    .slice(0, maxEvidence);
  const explanationConfidence = buildExplanationConfidence(evidence);
  const timeline = [
    ...signalTimeline(event, options.signals ?? []),
    ...evidence.map<InvestigationTimelineEntry>((item) => ({
      timestamp: item.publishedAt,
      kind: "context",
      label: "contextual evidence published",
      evidenceId: item.id,
      sourceName: item.source.name,
    })),
  ].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const status: InvestigationStatus = evidence.length
    ? "context_found"
    : retrievalStatus === "unavailable"
      ? "context_unavailable"
      : "no_explanation_found_yet";

  return {
    schemaVersion: 1,
    id: `investigation:${event.id}`,
    eventId: event.id,
    createdAt: now.toISOString(),
    window: eventWindow(event),
    location: eventLocation(event),
    status,
    retrievalStatus,
    providers,
    evidence,
    explanationConfidence,
    timeline,
    unknowns: [
      "No causal relationship is implied by temporal or geographic proximity.",
      "External reporting may be incomplete, delayed, duplicated or incorrect.",
      "Explanation confidence measures the strength of retrieved contextual support, not the probability that a proposed cause is true.",
      "NO EXPLANATION FOUND YET means no sufficiently relevant context was retrieved from the sources that were successfully searched, not that no explanation exists.",
    ],
  };
}
