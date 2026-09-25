import type { Investigation } from "../context/investigation";
import type { CorrelatedEvent } from "../correlations/types";
import type { Story, StoryExplanationStatus, StoryStatus } from "./types";

function titleFor(event: CorrelatedEvent) {
  const place = event.geographicScope.country ?? "Offshore / unassigned";
  const systems = event.signalTypes.length;
  return `${systems} unusual signal${systems === 1 ? "" : "s"} in ${place}`;
}

function assessmentFor(investigation: Investigation | null): {
  explanationStatus: StoryExplanationStatus;
  status: StoryStatus;
} {
  if (!investigation || investigation.retrievalStatus === "not_attempted")
    return { explanationStatus: "pending", status: "detected" };
  if (investigation.retrievalStatus === "unavailable")
    return { explanationStatus: "unavailable", status: "developing" };
  if (investigation.status === "no_explanation_found_yet")
    return { explanationStatus: "unexplained", status: "unexplained" };
  if (investigation.assessment === "independently_corroborated" || investigation.assessment === "official_report_found")
    return { explanationStatus: "corroborated", status: "corroborated" };
  return { explanationStatus: "reported", status: "developing" };
}

export function storyFromCorrelation(
  event: CorrelatedEvent,
  investigation: Investigation | null,
  now = new Date(),
): Story {
  const assessment = assessmentFor(investigation);
  const resolved = event.status === "resolved";
  return {
    id: `story:${event.id}`,
    fingerprint: `correlation:${event.id}`,
    correlationId: event.id,
    title: titleFor(event),
    status: resolved ? "resolved" : assessment.status,
    explanationStatus: assessment.explanationStatus,
    startedAt: event.startedAt,
    updatedAt: now.toISOString(),
    resolvedAt: resolved ? now.toISOString() : null,
    location: event.geographicScope,
    signalIds: event.signalIds,
    signalTypes: event.signalTypes,
    confidence: event.confidence,
    correlationStrength: event.correlationStrength,
    provenance: event.provenance,
  };
}
