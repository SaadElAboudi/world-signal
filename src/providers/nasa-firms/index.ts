import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { latLngToCell } from "h3-js";
import { fetchText } from "../http";
import { getConfig } from "../../server/config";
import { DataError } from "../../server/log";
import type {
  FetchContext,
  NormalizedBatch,
  ObservationProvider,
  RawBatch,
} from "../contract";
export const FIRMS_PUBLIC_ROOT =
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/";
const numeric = (v: string | undefined) => (v?.trim() ? Number(v) : null);
export class FirmsProvider implements ObservationProvider<string> {
  id = "firms";
  name = "NASA FIRMS · NOAA-20 VIIRS";
  type = "wildfire" as const;
  async fetchRawData(context: FetchContext): Promise<RawBatch<string>> {
    const config = getConfig();
    const days = context.days ?? (context.history ? 7 : 1);
    if (context.startDate && config.firmsTransport !== "api")
      throw new DataError("historical_api_requires_credentials");
    if (!Number.isInteger(days) || days < 1 || days > 10)
      throw new DataError("invalid_day_range");
    let url = `${FIRMS_PUBLIC_ROOT}J1_VIIRS_C2_Global_${days === 7 ? "7d" : "24h"}.csv`;
    if (config.firmsTransport === "api") {
      if (!config.firmsKey) throw new DataError("missing_credentials");
      url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(config.firmsKey)}/VIIRS_NOAA20_NRT/world/${days}${context.startDate ? `/${context.startDate}` : ""}`;
    }
    const response = await fetchText(url);
    if (!response.text.trimStart().startsWith("latitude,longitude,"))
      throw new DataError("invalid_firms_response");
    const lastModified = Date.parse(
      response.headers.get("last-modified") ??
        response.headers.get("date") ??
        "",
    );
    if (
      !Number.isFinite(lastModified) ||
      lastModified > context.now.getTime() + 300000
    )
      throw new DataError("invalid_source_timestamp");
    const coverageStart = context.startDate
      ? Date.parse(`${context.startDate}T00:00:00.000Z`)
      : lastModified - days * 86400000;
    if (!Number.isFinite(coverageStart) || coverageStart >= lastModified)
      throw new DataError("invalid_history_date");
    const coverageEnd = context.startDate
      ? Math.min(lastModified, coverageStart + days * 86400000)
      : lastModified;
    return {
      data: response.text,
      fetchedAt: context.now.toISOString(),
      sourceAsOf: new Date(lastModified).toISOString(),
      coverageStart: new Date(coverageStart).toISOString(),
      coverageEnd: new Date(coverageEnd).toISOString(),
      sourceUrl:
        config.firmsTransport === "api"
          ? "https://firms.modaps.eosdis.nasa.gov/api/area/"
          : url,
    };
  }
  normalize(raw: RawBatch<string>): NormalizedBatch {
    let rows: Record<string, string>[];
    try {
      rows = parse(raw.data, {
        columns: (headers: string[]) => {
          for (const required of [
            "latitude",
            "longitude",
            "acq_date",
            "acq_time",
            "confidence",
            "satellite",
            "frp",
          ]) {
            if (!headers.includes(required))
              throw new DataError("invalid_csv_header");
          }
          return headers;
        },
        bom: true,
        skip_empty_lines: true,
        trim: true,
        max_record_size: 4096,
      });
    } catch {
      throw new DataError("invalid_csv");
    }
    if (!rows.length && !raw.data.startsWith("latitude,longitude,"))
      throw new DataError("invalid_csv_header");
    let rejected = 0;
    const observations = new Map<
      string,
      NormalizedBatch["observations"][number]
    >();
    for (const row of rows) {
      const latitude = numeric(row.latitude),
        longitude = numeric(row.longitude),
        rawFrp = numeric(row.frp),
        brightness = numeric(row.bright_ti4);
      const frp = rawFrp !== null && rawFrp < 0 ? null : rawFrp;
      const sourceConfidence = row.confidence?.toLowerCase();
      const confidence =
        ({ low: "l", nominal: "n", high: "h" } as Record<string, string>)[
          sourceConfidence
        ] ?? sourceConfidence;
      const time = row.acq_time?.padStart(4, "0");
      const timestamp = `${row.acq_date}T${time?.slice(0, 2)}:${time?.slice(2, 4)}:00.000Z`;
      const millis = Date.parse(timestamp);
      if (
        latitude === null ||
        longitude === null ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.acq_date ?? "") ||
        !/^([01]\d|2[0-3])[0-5]\d$/.test(time ?? "") ||
        !Number.isFinite(millis) ||
        new Date(millis).toISOString() !== timestamp ||
        millis > Date.parse(raw.sourceAsOf) + 300000 ||
        !["l", "n", "h"].includes(confidence) ||
        !row.satellite ||
        (frp !== null && (!Number.isFinite(frp) || frp < 0)) ||
        (brightness !== null && !Number.isFinite(brightness))
      ) {
        rejected++;
        continue;
      }
      const upstreamId = `${row.satellite}:VIIRS:${timestamp}:${latitude.toFixed(6)}:${longitude.toFixed(6)}`;
      observations.set(upstreamId, {
        id: createHash("sha256").update(`firms:${upstreamId}`).digest("hex"),
        provider: this.id,
        upstreamId,
        type: this.type,
        latitude,
        longitude,
        timestamp,
        sourceUpdatedAt: raw.sourceAsOf,
        value: frp,
        cellId: latLngToCell(latitude, longitude, 3),
        quality: confidence === "h" ? 1 : confidence === "n" ? 0.7 : 0.2,
        sourceUrl: `${FIRMS_PUBLIC_ROOT}J1_VIIRS_C2_Global_7d.csv`,
        active: true,
        properties: {
          confidence,
          sourceConfidence,
          brightness,
          frp,
          rawFrp,
          satellite: row.satellite,
          instrument: "VIIRS",
          collection: row.version ?? null,
          daynight: row.daynight ?? null,
          scan: numeric(row.scan),
          track: numeric(row.track),
          upstreamSource: raw.sourceUrl,
        },
      });
    }
    return {
      observations: [...observations.values()],
      received: rows.length,
      rejected,
      sourceAsOf: raw.sourceAsOf,
      coverageStart: raw.coverageStart,
      coverageEnd: raw.coverageEnd,
    };
  }
}
