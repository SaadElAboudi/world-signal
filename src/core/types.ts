import type { CorrelatedEvent } from "../correlations/types";
export type SignalType = "earthquake" | "wildfire" | "internet" | "aviation";
export type Severity = "notable" | "elevated" | "significant";
export type DeviationType = "percentage" | "ratio" | "zscore" | "absolute";
export interface EvidencePoint {
  timestamp: string;
  value: number;
}
export interface WorldSignal {
  id: string;
  providerId?: string;
  scopeKey?: string;
  type: SignalType;
  title: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  observedValue: number;
  expectedValue: number | null;
  unit: string;
  deviation: number | null;
  deviationType: DeviationType;
  severity: Severity;
  source: { name: string; url: string };
  provenance: "synthetic" | "observed";
  description: string;
  methodology: string;
  limitation: string;
  confidence: number;
  /** A transparent triage score. It ranks data-supported change, not danger or cause. */
  assessment?: SignalAssessment;
  baseline: EvidencePoint[];
  context: string;
  kind?:
    | "earthquake-event"
    | "earthquake-cluster"
    | "fire-cluster"
    | "internet-anomaly"
    | "aviation-anomaly"
    | "aviation-disruption";

  startedAt?: string;
  updatedAt?: string;
  sourceAsOf?: string;
  status?: "detected" | "active" | "recovering" | "resolved";
  baselineLabel?: string;
  evidence?: SignalEvidence;
  magnitude?: number;
  depth?: number;
}
export interface SignalAssessment {
  score: number;
  anomalyStrength: number;
  persistenceMinutes: number;
  storyEligible: boolean;
  methodology: string;
}
export interface SignalEvidence {
  observationWindowHours: number;
  windowStart: string;
  windowEnd: string;
  baselineSamples: number;
  baselineTargetSamples: number;
  baselineWindowHours: number;
  baselineStart: string | null;
  baselineEnd: string | null;
  ratio: number | null;
  zscore: number | null;
  observationCount: number;
  observationIds: string[];
  cellId?: string;
  frpMw?: number | null;
  frpSampleCount?: number;
  confidenceDistribution?: Record<string, number>;
  thresholds: Record<string, number | number[]>;
  confidenceMethod: string;
}
export interface ProviderHealth {
  system?: SignalType;
  scopes?: { configured: number; available: number; fresh: number };
  historyDays?: number;
  analysisState?: "ready" | "collecting_history";
  cadenceMinutes?: number;
  id?: string;
  name: string;
  status: "demo" | "healthy" | "delayed" | "unavailable" | "error";
  lastSuccessAt?: string | null;
  lastAnalysisAt?: string | null;
  analysisError?: string | null;
  sourceAsOf?: string | null;
  latestObservationAt?: string | null;
  recordsReceived?: number;
  recordsInserted?: number;
  recordsUpdated?: number;
  error?: string | null;
}
export interface SignalSnapshot {
  correlations?: CorrelatedEvent[];
  correlationAsOf?: string | null;
  collectionCadenceMinutes?: number;
  mode: "demo" | "live";
  asOf: string;
  signals: WorldSignal[];
  providers: ProviderHealth[];
  status?: "demo" | "live" | "partial" | "delayed" | "unavailable";
  total?: number;
  truncated?: boolean;
}
export interface SignalProvider {
  id: string;
  getSnapshot(): Promise<SignalSnapshot>;
}
export const LAYERS: {
  id: SignalType;
  name: string;
  color: string;
  description: string;
}[] = [
  {
    id: "earthquake",
    name: "Earthquakes",
    color: "#d2a7ff",
    description: "Seismic activity",
  },
  {
    id: "wildfire",
    name: "Wildfires",
    color: "#ffad6c",
    description: "Thermal detections",
  },
  {
    id: "internet",
    name: "Internet",
    color: "#7cb6ff",
    description: "Connectivity changes",
  },
  {
    id: "aviation",
    name: "Aviation",
    color: "#69d6bc",
    description: "Regional air traffic",
  },
];
export const SEVERITY_COLOR: Record<Severity | "info", string> = {
  significant: "#ff746b",
  elevated: "#f5b75f",
  notable: "#e5d785",
  info: "#78909a",
};
