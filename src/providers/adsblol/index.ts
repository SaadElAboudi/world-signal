import { createHash } from "node:crypto";
import { latLngToCell } from "h3-js";
import { z } from "zod";
import type {
  FetchContext,
  NormalizedBatch,
  Observation,
  ObservationProvider,
  RawBatch,
} from "../contract";

const responseSchema = z.object({
  ac: z.array(
    z.object({
      hex: z.string().min(1),
      lat: z.number().finite().nullable().optional(),
      lon: z.number().finite().nullable().optional(),
      seen: z.number().finite().nonnegative(),
      seen_pos: z.number().finite().nonnegative().nullable().optional(),
      alt_baro: z.union([z.number().finite(), z.string(), z.null()]).optional(),
    }),
  ),
  total: z.number().int().nonnegative(),
});

export interface AviationSentinel {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusNm: number;
}

export const AVIATION_SENTINELS: readonly AviationSentinel[] = [
  { id: "us-northeast", name: "US Northeast", latitude: 40.7, longitude: -74.0, radiusNm: 250 },
  { id: "us-southeast", name: "US Southeast", latitude: 33.7, longitude: -84.4, radiusNm: 250 },
  { id: "us-west", name: "US West Coast", latitude: 34.0, longitude: -118.2, radiusNm: 250 },
  { id: "mexico", name: "Mexico / Central America", latitude: 19.4, longitude: -99.1, radiusNm: 250 },
  { id: "brazil", name: "Southeast Brazil", latitude: -23.5, longitude: -46.6, radiusNm: 250 },
  { id: "uk-north-sea", name: "UK / North Sea", latitude: 51.5, longitude: -0.1, radiusNm: 250 },
  { id: "western-europe", name: "Western Europe", latitude: 49.0, longitude: 6.0, radiusNm: 250 },
  { id: "iberia", name: "Iberia", latitude: 40.4, longitude: -3.7, radiusNm: 250 },
  { id: "italy-alps", name: "Alps / Northern Italy", latitude: 45.5, longitude: 9.2, radiusNm: 250 },
  { id: "scandinavia", name: "Scandinavia", latitude: 59.3, longitude: 18.1, radiusNm: 250 },
  { id: "east-med", name: "Eastern Mediterranean", latitude: 38.0, longitude: 27.0, radiusNm: 250 },
  { id: "gulf", name: "Persian Gulf", latitude: 25.2, longitude: 55.3, radiusNm: 250 },
  { id: "east-africa", name: "East Africa", latitude: -1.3, longitude: 36.8, radiusNm: 250 },
  { id: "south-africa", name: "Southern Africa", latitude: -26.2, longitude: 28.0, radiusNm: 250 },
  { id: "north-india", name: "North India", latitude: 28.6, longitude: 77.2, radiusNm: 250 },
  { id: "south-india", name: "South India", latitude: 12.9, longitude: 77.6, radiusNm: 250 },
  { id: "southeast-asia", name: "Southeast Asia", latitude: 1.35, longitude: 103.8, radiusNm: 250 },
  { id: "east-china", name: "East China", latitude: 31.2, longitude: 121.5, radiusNm: 250 },
  { id: "japan-korea", name: "Japan / Korea", latitude: 35.7, longitude: 139.7, radiusNm: 250 },
  { id: "australia-se", name: "Southeast Australia", latitude: -33.9, longitude: 151.2, radiusNm: 250 },
] as const;

type RawSentinel = {
  sentinel: AviationSentinel;
  count: number;
};

type RawData = { snapshots: RawSentinel[] };

type FetchLike = typeof fetch;

function bucketStart(date: Date) {
  const bucketMs = 15 * 60_000;
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs);
}

export class AdsbLolProvider implements ObservationProvider<RawData> {
  id = "adsblol";
  name = "ADSB.lol";
  type = "aviation" as const;
  private readonly fetchImpl: FetchLike;
  private readonly endpoint: string;
  private readonly sentinels: readonly AviationSentinel[];

  constructor(options: {
    fetchImpl?: FetchLike;
    endpoint?: string;
    sentinels?: readonly AviationSentinel[];
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = options.endpoint ?? "https://api.adsb.lol";
    this.sentinels = options.sentinels ?? AVIATION_SENTINELS;
  }

  async fetchRawData(context: FetchContext): Promise<RawBatch<RawData>> {
    const fetchedAt = context.now.toISOString();
    const snapshots: RawSentinel[] = [];
    for (const sentinel of this.sentinels) {
      const url = `${this.endpoint}/v2/point/${sentinel.latitude}/${sentinel.longitude}/${sentinel.radiusNm}`;
      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": "WORLD-SIGNAL/0.2" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`ADSB.lol request failed: ${response.status}`);
      const payload = responseSchema.parse(await response.json());
      const fresh = new Set<string>();
      for (const aircraft of payload.ac) {
        if (
          aircraft.lat === null || aircraft.lat === undefined ||
          aircraft.lon === null || aircraft.lon === undefined ||
          Math.abs(aircraft.lat) > 90 || Math.abs(aircraft.lon) > 180 ||
          aircraft.seen_pos === null || aircraft.seen_pos === undefined ||
          aircraft.seen_pos > 30 ||
          aircraft.alt_baro === "ground"
        ) continue;
        fresh.add(aircraft.hex.toLowerCase());
      }
      snapshots.push({ sentinel, count: fresh.size });
    }
    const bucket = bucketStart(context.now).toISOString();
    return {
      data: { snapshots },
      fetchedAt,
      sourceAsOf: fetchedAt,
      coverageStart: bucket,
      coverageEnd: new Date(Date.parse(bucket) + 15 * 60_000).toISOString(),
      sourceUrl: "https://www.adsb.lol/",
    };
  }

  normalize(raw: RawBatch<RawData>): NormalizedBatch {
    const timestamp = bucketStart(new Date(raw.fetchedAt)).toISOString();
    const observations: Observation[] = raw.data.snapshots.map(({ sentinel, count }) => {
      const upstreamId = `${sentinel.id}:${timestamp}`;
      return {
        id: `adsblol:${createHash("sha256").update(upstreamId).digest("hex")}`,
        upstreamId,
        provider: this.id,
        type: "aviation",
        latitude: sentinel.latitude,
        longitude: sentinel.longitude,
        timestamp,
        sourceUpdatedAt: raw.fetchedAt,
        value: count,
        cellId: latLngToCell(sentinel.latitude, sentinel.longitude, 2),
        quality: 0.55,
        sourceUrl: "https://www.adsb.lol/",
        properties: {
          metric: "observed_airborne_aircraft_snapshot",
          seriesKey: sentinel.id,
          region: sentinel.name,
          radiusNm: sentinel.radiusNm,
          stepSeconds: 900,
          snapshotSeconds: 30,
          sourceLicense: "ODbL-1.0",
          coverage: "sentinel-radius-only",
          individualAircraftRetained: false,
        },
        active: true,
      };
    });
    return {
      observations,
      received: observations.length,
      rejected: 0,
      sourceAsOf: raw.sourceAsOf,
      coverageStart: raw.coverageStart,
      coverageEnd: raw.coverageEnd,
    };
  }
}
