import type { WorldSignal } from "../core/types";
import type { CorrelatedEvent } from "../correlations/types";
export interface ContextEvidence {
  id: string;
  source: { name: string; url: string };
  publishedAt: string;
  retrievedAt: string;
  text: string;
}
export interface ContextProvider {
  id: string;
  searchContext(
    event: WorldSignal | CorrelatedEvent,
  ): Promise<ContextEvidence[]>;
}
// No retrieval or LLM execution. This package contains only supplied evidence.
export function buildEvidencePackage(
  event: WorldSignal | CorrelatedEvent,
  signals: WorldSignal[] = [],
) {
  const correlated = "signalIds" in event;
  const byId = new Map(signals.map((signal) => [signal.id, signal]));
  const members = correlated
    ? event.signalIds.map((id) => {
        const signal = byId.get(id);
        if (!signal) throw new Error(`Missing underlying signal: ${id}`);
        if (signal.provenance !== event.provenance)
          throw new Error("Mixed evidence provenance");
        return signal;
      })
    : [event];
  const ordered = [...members].sort(
    (a, b) =>
      Date.parse(a.startedAt ?? a.timestamp) -
        Date.parse(b.startedAt ?? b.timestamp) || a.id.localeCompare(b.id),
  );
  return {
    schemaVersion: 1,
    id: event.id,
    provenance: event.provenance,
    location: correlated
      ? event.geographicScope
      : {
          country: event.country,
          region: event.region,
          latitude: event.latitude,
          longitude: event.longitude,
        },
    window: {
      start: correlated
        ? event.startedAt
        : (event.startedAt ?? event.timestamp),
      end: correlated
        ? event.windowEnd
        : (event.evidence?.windowEnd ?? event.timestamp),
    },
    status: event.status ?? "active",
    methodology: event.methodology,
    signals: ordered.map((signal) => ({
      id: signal.id,
      type: signal.type,
      severity: signal.severity,
      observed: signal.observedValue,
      expected: signal.expectedValue,
      unit: signal.unit,
      deviation: signal.deviation,
      deviationType: signal.deviationType,
      baseline: signal.baseline,
      baselineLabel: signal.baselineLabel ?? null,
      confidence: signal.confidence,
      evidence: signal.evidence ?? null,
      sources: [{ ...signal.source, updatedAt: signal.sourceAsOf ?? null }],
      limitation: signal.limitation,
    })),
    timeline: ordered.map((signal) => ({
      signalId: signal.id,
      type: signal.type,
      timestamp: signal.startedAt ?? signal.timestamp,
      meaning:
        "First observation represented by this signal; not a verified incident onset.",
    })),
    unknowns: [
      "Causality has not been established.",
      "Measurements may not cover the whole area.",
      "The order of observations does not establish the order of real-world incident onsets.",
    ],
  };
}
