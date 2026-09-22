import type { WorldSignal } from "../core/types";
import type { CorrelatedEvent } from "../correlations/types";
import type { ContextEvidence, ContextProvider } from "./evidence";

export type InvestigationStatus =
  | "no_explanation_found_yet"
  | "context_found"
  | "context_unavailable";
export type ContextRetrievalStatus = "not_attempted" | "complete" | "partial" | "unavailable";

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
  scoreBreakdown: { temporal: number; geographic: number; source: number };
  matchedTerms: string[];
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
  timeline: InvestigationTimelineEntry[];
  unknowns: string[];
}

export interface BuildInvestigationOptions {
  providers: ContextProvider[];
  signals?: WorldSignal[];
  now?: Date;
  maxEvidence?: number;
}

const sourceTrust = (name: string) => {
  const normalized = name.toLowerCase();
  if (/(government|official|authority|agency|ministry|prefecture|police|fire|usgs|nasa)/.test(normalized)) return 1;
  if (/(reuters|ap|afp|bbc|guardian|nytimes|le monde|franceinfo)/.test(normalized)) return 0.9;
  return 0.65;
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function eventWindow(event: WorldSignal | CorrelatedEvent) {
  return "signalIds" in event
    ? { start: event.startedAt, end: event.windowEnd }
    : { start: event.startedAt ?? event.timestamp, end: event.evidence?.windowEnd ?? event.timestamp };
}
function eventLocation(event: WorldSignal | CorrelatedEvent): InvestigationLocation {
  return "signalIds" in event
    ? { country: event.geographicScope.country, region: null, latitude: event.geographicScope.latitude, longitude: event.geographicScope.longitude }
    : { country: event.country, region: event.region, latitude: event.latitude, longitude: event.longitude };
}
function tokenise(value: string | null | undefined) {
  return (value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
}
function scoreEvidence(event: WorldSignal | CorrelatedEvent, evidence: ContextEvidence): RankedContextEvidence {
  const window = eventWindow(event);
  const location = eventLocation(event);
  const eventStart = Date.parse(window.start);
  const published = Date.parse(evidence.publishedAt);
  const deltaMinutes = Number.isFinite(eventStart) && Number.isFinite(published) ? Math.abs(published - eventStart) / 60000 : Number.POSITIVE_INFINITY;
  const temporal = clamp(1 - deltaMinutes / (12 * 60));
  const evidenceTokens = new Set(tokenise(evidence.text));
  const locationTokens = [...tokenise(location.country), ...tokenise(location.region)];
  const matchedTerms = locationTokens.filter((token) => evidenceTokens.has(token));
  const geographic = locationTokens.length ? clamp(matchedTerms.length / locationTokens.length) : 0.5;
  const source = sourceTrust(evidence.source.name);
  const score = Number((temporal * 0.5 + geographic * 0.3 + source * 0.2).toFixed(4));
  return { ...evidence, score, scoreBreakdown: { temporal: Number(temporal.toFixed(4)), geographic: Number(geographic.toFixed(4)), source: Number(source.toFixed(4)) }, matchedTerms };
}
function signalTimeline(event: WorldSignal | CorrelatedEvent, signals: WorldSignal[]) {
  const ids = "signalIds" in event ? new Set(event.signalIds) : new Set([event.id]);
  const members = signals.filter((signal) => ids.has(signal.id));
  const fallback: WorldSignal[] = "signalIds" in event ? [] : [event];
  return (members.length ? members : fallback).map<InvestigationTimelineEntry>((signal) => ({ timestamp: signal.startedAt ?? signal.timestamp, kind: "signal", label: `${signal.type} anomaly detected`, signalId: signal.id }));
}
function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 160) : "provider_error";
}

export async function buildInvestigation(event: WorldSignal | CorrelatedEvent, options: BuildInvestigationOptions): Promise<Investigation> {
  const now = options.now ?? new Date();
  const maxEvidence = options.maxEvidence ?? 12;
  const settled = await Promise.allSettled(options.providers.map((provider) => provider.searchContext(event)));
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
      const existing = byUrl.get(item.source.url);
      if (!existing || Date.parse(item.retrievedAt) > Date.parse(existing.retrievedAt)) byUrl.set(item.source.url, item);
    }
  }
  const evidence = [...byUrl.values()].map((item) => scoreEvidence(event, item)).filter((item) => item.score >= 0.35).sort((a, b) => b.score - a.score || Date.parse(a.publishedAt) - Date.parse(b.publishedAt)).slice(0, maxEvidence);
  const timeline = [...signalTimeline(event, options.signals ?? []), ...evidence.map<InvestigationTimelineEntry>((item) => ({ timestamp: item.publishedAt, kind: "context", label: "contextual evidence published", evidenceId: item.id, sourceName: item.source.name }))].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const status: InvestigationStatus = evidence.length ? "context_found" : retrievalStatus === "unavailable" ? "context_unavailable" : "no_explanation_found_yet";

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
    timeline,
    unknowns: [
      "No causal relationship is implied by temporal or geographic proximity.",
      "External reporting may be incomplete, delayed, duplicated or incorrect.",
      "NO EXPLANATION FOUND YET means no sufficiently relevant context was retrieved from the sources that were successfully searched, not that no explanation exists.",
    ],
  };
}
