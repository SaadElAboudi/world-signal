import type { EventCategory, EventType } from "./types";

export interface EventSourceMetadata {
  id: string;
  name: string;
  categories: EventCategory[];
  types: EventType[];
  cadenceMinutes: number;
  retention: "event_state" | "aggregate_only";
  operational: boolean;
  sourceUrl: string;
}

export const EVENT_SOURCE_REGISTRY: readonly EventSourceMetadata[] = [
  {
    id: "eonet",
    name: "NASA EONET",
    categories: ["natural_hazard", "climate", "environment"],
    types: [
      "wildfire",
      "volcano",
      "severe_storm",
      "flood",
      "landslide",
      "drought",
      "dust_haze",
      "sea_lake_ice",
      "snow",
      "temperature_extreme",
      "water_anomaly",
      "earthquake",
    ],
    cadenceMinutes: 15,
    retention: "event_state",
    operational: true,
    sourceUrl: "https://eonet.gsfc.nasa.gov/",
  },
  {
    id: "open-meteo",
    name: "Open-Meteo Weather + ERA5 climatology",
    categories: ["climate", "natural_hazard"],
    types: ["temperature_extreme", "high_wind", "heavy_rain"],
    cadenceMinutes: 15,
    retention: "event_state",
    operational: true,
    sourceUrl: "https://open-meteo.com/",
  },
  {
    id: "open-meteo-marine",
    name: "Open-Meteo Marine",
    categories: ["climate"],
    types: ["water_anomaly"],
    cadenceMinutes: 60,
    retention: "event_state",
    operational: true,
    sourceUrl: "https://open-meteo.com/en/docs/marine-weather-api",
  },
  {
    id: "ioda",
    name: "IODA",
    categories: ["infrastructure"],
    types: ["internet_outage"],
    cadenceMinutes: 5,
    retention: "aggregate_only",
    operational: true,
    sourceUrl: "https://ioda.inetintel.cc.gatech.edu/",
  },
  {
    id: "adsblol",
    name: "ADSB.lol",
    categories: ["mobility"],
    types: ["aviation_disruption"],
    cadenceMinutes: 15,
    retention: "aggregate_only",
    operational: true,
    sourceUrl: "https://www.adsb.lol/",
  },
  {
    id: "opensky",
    name: "OpenSky Network",
    categories: ["mobility"],
    types: ["aviation_disruption"],
    cadenceMinutes: 5,
    retention: "aggregate_only",
    operational: false,
    sourceUrl: "https://opensky-network.org/",
  },
  {
    id: "entsoe",
    name: "ENTSO-E Transparency Platform",
    categories: ["infrastructure"],
    types: ["power_grid_anomaly"],
    cadenceMinutes: 60,
    retention: "aggregate_only",
    operational: false,
    sourceUrl: "https://transparency.entsoe.eu/",
  },
];
