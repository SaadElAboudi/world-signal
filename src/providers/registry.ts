import type { SignalType } from "../core/types";

export interface ProviderMetadata {
  id: string;
  name: string;
  system: SignalType;
  independenceGroup: string;
  sourceUrl: string;
  operational: boolean;
}

// Registration is not activation: candidate providers must pass access, licence,
// normalization and coverage checks before entering the operational collector.
export const PROVIDER_REGISTRY: readonly ProviderMetadata[] = [
  {
    id: "usgs",
    name: "USGS",
    system: "earthquake",
    independenceGroup: "seismic",
    sourceUrl: "https://earthquake.usgs.gov/",
    operational: true,
  },
  {
    id: "firms",
    name: "NASA FIRMS",
    system: "wildfire",
    independenceGroup: "thermal",
    sourceUrl: "https://firms.modaps.eosdis.nasa.gov/",
    operational: true,
  },
  {
    id: "ioda",
    name: "IODA",
    system: "internet",
    independenceGroup: "internet-measurement",
    sourceUrl: "https://ioda.inetintel.cc.gatech.edu/",
    operational: false,
  },
  {
    id: "cloudflare",
    name: "Cloudflare Radar",
    system: "internet",
    independenceGroup: "internet-measurement",
    sourceUrl: "https://radar.cloudflare.com/",
    operational: false,
  },
  {
    id: "opensky",
    name: "OpenSky Network",
    system: "aviation",
    independenceGroup: "aviation-measurement",
    sourceUrl: "https://opensky-network.org/",
    operational: false,
  },
];
export function providerMetadata(id: string) {
  return PROVIDER_REGISTRY.find((provider) => provider.id === id);
}
