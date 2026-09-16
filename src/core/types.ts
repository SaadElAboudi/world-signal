export type SignalType = "earthquake" | "wildfire" | "internet" | "aviation";
export type Severity = "notable" | "elevated" | "significant";
export type DeviationType = "percentage" | "ratio" | "zscore";
export interface EvidencePoint {
  timestamp: string;
  value: number;
}
export interface WorldSignal {
  id: string;
  type: SignalType;
  title: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  observedValue: number;
  expectedValue: number;
  unit: string;
  deviation: number | null;
  deviationType: DeviationType;
  severity: Severity;
  source: { name: string; url: string };
  provenance: "synthetic" | "observed";
  description: string;
  methodology: string;
  limitation: string;
  confidence: "high" | "medium" | "low";
  baseline: EvidencePoint[];
  context: string;
  magnitude?: number;
  depth?: number;
}
export interface SignalSnapshot {
  mode: "demo" | "live";
  asOf: string;
  signals: WorldSignal[];
  providers: { name: string; status: "demo" | "connected" | "unavailable" }[];
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
export const SEVERITY_COLOR: Record<Severity, string> = {
  significant: "#ff746b",
  elevated: "#f5b75f",
  notable: "#e5d785",
};
