import type { CorrelatedEvent } from "../correlations/types";

export type StoryStatus =
  | "detected"
  | "developing"
  | "corroborated"
  | "confirmed"
  | "unexplained"
  | "resolved";

export type StoryExplanationStatus =
  | "pending"
  | "reported"
  | "corroborated"
  | "unexplained"
  | "unavailable";

export interface Story {
  id: string;
  fingerprint: string;
  correlationId: string;
  title: string;
  status: StoryStatus;
  explanationStatus: StoryExplanationStatus;
  startedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  location: CorrelatedEvent["geographicScope"];
  signalIds: string[];
  signalTypes: CorrelatedEvent["signalTypes"];
  confidence: number;
  correlationStrength: number;
  provenance: CorrelatedEvent["provenance"];
}
