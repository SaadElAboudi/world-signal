import { classify, deviation, mean } from "../core/analysis";
import type {
  SignalProvider,
  SignalSnapshot,
  SignalType,
  WorldSignal,
} from "../core/types";
export const DEMO_TIME = "2026-09-16T21:43:00.000Z";
const sources = {
  earthquake: {
    name: "USGS · reference",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
  },
  wildfire: {
    name: "NASA FIRMS · reference",
    url: "https://firms.modaps.eosdis.nasa.gov/",
  },
  internet: {
    name: "Cloudflare Radar · reference",
    url: "https://radar.cloudflare.com/",
  },
  aviation: {
    name: "OpenSky Network · reference",
    url: "https://opensky-network.org/",
  },
};
type Seed = [
  SignalType,
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  string,
  number?,
  number?,
];
const seeds: Seed[] = [
  [
    "earthquake",
    "Japan",
    "Off the coast of Honshu",
    37.4,
    141.6,
    0.18,
    19,
    6,
    "M6.4 earthquake · unusual cluster",
    6.4,
    32,
  ],
  [
    "wildfire",
    "Brazil",
    "Northern Amazon",
    -5.5,
    -57,
    0.42,
    472,
    102,
    "Fire detections surge in the Amazon",
  ],
  [
    "internet",
    "Iran",
    "National connectivity",
    32.4,
    53.7,
    0.7,
    62,
    100,
    "Sharp decline in internet activity",
  ],
  [
    "aviation",
    "Cyprus",
    "Eastern Mediterranean",
    34.5,
    33.2,
    1.4,
    146,
    200,
    "Regional air traffic below baseline",
  ],
  [
    "wildfire",
    "Portugal",
    "Castelo Branco",
    39.8,
    -7.5,
    2.1,
    86,
    32,
    "Elevated thermal detections",
  ],
  [
    "earthquake",
    "Indonesia",
    "Banda Sea",
    -6,
    129.5,
    3.3,
    12,
    5,
    "Seismic cluster in the Banda Sea",
    5.8,
    84,
  ],
  [
    "aviation",
    "United States of America",
    "New York airspace",
    40.7,
    -74,
    4.2,
    332,
    400,
    "Air traffic below typical levels",
  ],
  [
    "internet",
    "Kenya",
    "National connectivity",
    -0.5,
    37.8,
    5.6,
    76,
    100,
    "Sustained connectivity reduction",
  ],
  [
    "wildfire",
    "Australia",
    "Northern Territory",
    -15.5,
    133.5,
    8.8,
    194,
    100,
    "Fire activity above recent baseline",
  ],
  [
    "earthquake",
    "Chile",
    "Atacama coast",
    -27.3,
    -71,
    13,
    10,
    5,
    "Elevated offshore seismic activity",
    5.4,
    24,
  ],
  [
    "internet",
    "Pakistan",
    "National connectivity",
    30.4,
    69.3,
    29,
    84,
    100,
    "Internet activity below reference",
  ],
  [
    "aviation",
    "Iceland",
    "North Atlantic corridor",
    64.9,
    -19,
    48,
    58,
    80,
    "Reduced regional flight activity",
  ],
  [
    "wildfire",
    "Canada",
    "British Columbia",
    54,
    -124,
    96,
    310,
    100,
    "Thermal activity above reference",
  ],
  [
    "earthquake",
    "New Zealand",
    "Kermadec Islands",
    -29.9,
    -178.1,
    220,
    13,
    5,
    "Offshore earthquake cluster",
    6.1,
    18,
  ],
];
const variation = [-2, -1, 0, 1, 2, -1, 1, 0, -2, 2];
function makeSignal(seed: Seed, index: number): WorldSignal {
  const [
    type,
    country,
    region,
    latitude,
    longitude,
    age,
    observedValue,
    average,
    title,
    magnitude,
    depth,
  ] = seed;
  const timestamp = new Date(
    Date.parse(DEMO_TIME) - age * 3600000,
  ).toISOString();
  const baseline = Array.from({ length: 30 }, (_, day) => ({
    timestamp: new Date(
      Date.parse(timestamp) - (30 - day) * 86400000,
    ).toISOString(),
    value:
      average +
      variation[day % variation.length] *
        (type === "earthquake" ? 1 : average * 0.04),
  }));
  const deviationType =
    type === "earthquake"
      ? "zscore"
      : type === "wildfire"
        ? "ratio"
        : "percentage";
  const delta = deviation(
    observedValue,
    baseline.map((p) => p.value),
    deviationType,
  );
  const expectedValue = mean(baseline.map((p) => p.value))!;
  const unit =
    type === "earthquake"
      ? "events / 24h"
      : type === "wildfire"
        ? "detections / 24h"
        : type === "internet"
          ? "traffic index"
          : "aircraft / hour";
  return {
    id: `demo-${type}-${index}`,
    type,
    title,
    country,
    region,
    latitude,
    longitude,
    timestamp,
    observedValue,
    expectedValue,
    unit,
    deviation: delta,
    deviationType,
    severity: classify(delta, type) ?? "notable",
    source: sources[type],
    provenance: "synthetic",
    description: `In this simulated scenario, ${region} records ${observedValue} ${unit}, compared with a 30-day reference mean of ${expectedValue.toFixed(0)}.`,
    methodology: `Compare the current ${type === "aviation" ? "hour" : type === "internet" ? "indexed measurement" : "24-hour window"} with 30 synthetic daily reference samples. ${deviationType === "zscore" ? "Z-score = (observed − mean) / population standard deviation." : deviationType === "ratio" ? "Ratio = observed / reference mean." : "Change = (observed − reference mean) / reference mean × 100."} Current observation is excluded from the reference.`,
    limitation:
      "Synthetic demonstration data, not an actual event. Source links describe intended providers and do not corroborate this scenario. This reference does not model seasonality or reporting delays.",
    confidence: "low",
    baseline,
    magnitude,
    depth,
    context:
      type === "earthquake"
        ? "A cluster can indicate an active seismic sequence. Event counts alone cannot predict a larger earthquake; depth, magnitude and local context matter."
        : type === "wildfire"
          ? "More thermal detections can indicate increased fire activity. Satellite overpasses, cloud cover and agricultural burning also affect the count; detections are not individual fires."
          : type === "internet"
            ? "A sustained traffic reduction can affect access to online services. Traffic alone does not establish the cause or how many people are disconnected."
            : "An unusual traffic reduction may affect regional connections. Weather, schedules, receiver coverage and reporting delays must be checked before drawing conclusions.",
  };
}
export const demoSnapshot: SignalSnapshot = {
  mode: "demo",
  asOf: DEMO_TIME,
  signals: seeds.map(makeSignal),
  providers: Object.values(sources).map((source) => ({
    name: source.name.replace(" · reference", ""),
    status: "demo",
  })),
};
export const demoProvider: SignalProvider = {
  id: "demo",
  async getSnapshot() {
    return demoSnapshot;
  },
};
