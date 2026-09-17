import type { Severity, SignalType, WorldSignal } from "../core/types";
export const CORRELATION_WINDOWS = [1, 6, 24] as const;
export type CorrelationWindow = (typeof CORRELATION_WINDOWS)[number];
export interface GeographicScope {
  kind: "country" | "h3";
  // Country names use the same Natural Earth ADMIN vocabulary as the globe.
  country: string | null;
  cellId?: string;
  latitude: number;
  longitude: number;
}
export interface CorrelationInput {
  signal: WorldSignal;
  providerId: string;
  scope: GeographicScope;
  // When this particular version was actually known; prevents hindsight leakage.
  recordedAt: string;
  endedAt?: string;
}
export interface CorrelationFactors {
  geographic: number;
  temporal: number;
  severity: number;
  independence: number;
  confidence: number;
}
export interface CandidateDecision {
  signalIds: [string, string];
  accepted: boolean;
  reason: string;
  factors: CorrelationFactors;
  score: number;
  threshold: number;
}
export interface CorrelatedEvent {
  id: string;
  geographicScope: GeographicScope;
  startedAt: string;
  updatedAt: string;
  windowEnd: string;
  windowHours: CorrelationWindow;
  signalIds: string[];
  signalTypes: SignalType[];
  providerIds: string[];
  correlationStrength: number;
  confidence: number;
  severity: Severity;
  status: "active" | "resolved";
  provenance: "synthetic" | "observed";
  methodology: string;
  relationship: string;
}
export interface ProviderConfirmation {
  system: SignalType;
  signalIds: string[];
  providerIds: string[];
  // A bounded corroboration indicator, never a probability.
  confidence: number;
}
