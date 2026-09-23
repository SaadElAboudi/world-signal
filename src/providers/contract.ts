import type { SignalType } from "../core/types";
export interface Observation {
  id: string;
  provider: string;
  upstreamId: string;
  type: SignalType;
  latitude: number;
  longitude: number;
  timestamp: string;
  sourceUpdatedAt: string;
  value: number | null;
  cellId: string;
  quality: number;
  sourceUrl: string;
  properties: Record<string, unknown>;
  active: boolean;
}
export interface FetchContext {
  history: boolean;
  now: Date;
  startDate?: string;
  days?: number;
}
export interface RawBatch<T> {
  data: T;
  fetchedAt: string;
  sourceAsOf: string;
  coverageStart: string;
  coverageEnd: string;
  sourceUrl: string;
}
export interface NormalizedBatch {
  completeSnapshot?: boolean;
  scopes?: import("./batch").ScopeCollection[];
  observations: Observation[];
  received: number;
  rejected: number;
  sourceAsOf: string;
  coverageStart: string;
  coverageEnd: string;
}
export interface ObservationProvider<T = unknown> {
  id: string;
  name: string;
  type: SignalType;
  fetchRawData(context: FetchContext): Promise<RawBatch<T>>;
  normalize(raw: RawBatch<T>): NormalizedBatch;
}
