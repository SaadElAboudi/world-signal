export type EventCategory =
  | "natural_hazard"
  | "climate"
  | "environment"
  | "infrastructure"
  | "mobility"
  | "earth_observation";

export type EventType =
  | "earthquake"
  | "wildfire"
  | "volcano"
  | "severe_storm"
  | "tropical_cyclone"
  | "tornado"
  | "flood"
  | "landslide"
  | "drought"
  | "dust_haze"
  | "sea_lake_ice"
  | "snow"
  | "temperature_extreme"
  | "marine_heatwave"
  | "high_wind"
  | "heavy_rain"
  | "tsunami"
  | "geomagnetic_storm"
  | "power_outage"
  | "power_grid_anomaly"
  | "internet_outage"
  | "aviation_disruption"
  | "air_quality"
  | "water_anomaly"
  | "other";

export type EventSeverity = "info" | "notable" | "elevated" | "significant";
export type EventStatus = "active" | "resolved";

export interface EventLocation {
  latitude: number;
  longitude: number;
  bbox?: [number, number, number, number];
  geometryType: "point" | "polygon" | "track";
}

export interface EventSource {
  provider: string;
  name: string;
  url: string;
  upstreamId: string;
}

export interface WorldEvent {
  schemaVersion: 1;
  id: string;
  category: EventCategory;
  type: EventType;
  title: string;
  description: string | null;
  status: EventStatus;
  severity: EventSeverity;
  confidence: number;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  location: EventLocation;
  magnitude: {
    value: number | null;
    unit: string | null;
    description: string | null;
  };
  source: EventSource;
  secondarySources: { name: string; url: string }[];
  properties: Record<string, string | number | boolean | null>;
}

export interface EventProvider {
  id: string;
  name: string;
  fetchEvents(options?: { now?: Date; days?: number; limit?: number }): Promise<WorldEvent[]>;
}
