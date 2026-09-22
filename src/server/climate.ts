import type { WorldEvent } from "../events/types";
import { fetchText } from "../providers/http";
import {
  temperatureAnomaly,
  temperatureReferenceFromArchive,
  type TemperatureExtremeKind,
} from "../climate/reference";
import {
  getTemperatureReference,
  saveTemperatureReference,
  type StoredTemperatureReference,
} from "../database/climate-reference";

const REFERENCE_START = "1991-01-01";
const REFERENCE_END = "2020-12-31";
const MAX_NEW_REFERENCES_PER_REFRESH = 6;

type Options = {
  fetcher?: typeof fetch;
  endpoint?: string;
  apiKey?: string;
};

function monthDay(iso: string) {
  return iso.slice(5, 10);
}

function extremeKind(event: WorldEvent): TemperatureExtremeKind | null {
  const value = event.properties.extremeKind;
  return value === "heat" || value === "cold" ? value : null;
}

async function fetchReference(
  event: WorldEvent,
  kind: TemperatureExtremeKind,
  options: Options,
): Promise<StoredTemperatureReference> {
  const endpoint = options.endpoint ?? "https://archive-api.open-meteo.com/v1/archive";
  const url = new URL(endpoint);
  url.searchParams.set("latitude", String(event.location.latitude));
  url.searchParams.set("longitude", String(event.location.longitude));
  url.searchParams.set("start_date", REFERENCE_START);
  url.searchParams.set("end_date", REFERENCE_END);
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("models", "era5");
  if (options.apiKey) url.searchParams.set("apikey", options.apiKey);
  const { text } = await fetchText(url.toString(), {
    fetcher: options.fetcher ?? fetch,
    attempts: 2,
    timeoutMs: 30_000,
  });
  const stats = temperatureReferenceFromArchive(
    JSON.parse(text),
    new Date(event.startedAt),
    kind,
  );
  return {
    cellId: String(event.properties.cellId),
    kind,
    monthDay: monthDay(event.startedAt),
    ...stats,
    referenceStart: REFERENCE_START,
    referenceEnd: REFERENCE_END,
  };
}

function applyReference(event: WorldEvent, reference: StoredTemperatureReference) {
  if (event.magnitude.value === null) return event;
  const anomaly = temperatureAnomaly(event.magnitude.value, reference);
  const sign = anomaly.deltaC >= 0 ? "+" : "";
  return {
    ...event,
    title: `${event.title} · ${sign}${anomaly.deltaC.toFixed(1)}°C vs 1991–2020`,
    description: `${event.description ?? ""} ERA5 climatology for the same seasonal window: ${reference.meanC.toFixed(1)}°C mean (${reference.sampleCount} daily samples, ±7 calendar days across 1991–2020).`.trim(),
    properties: {
      ...event.properties,
      climateReference: "ERA5 1991-2020 seasonal-window-v1",
      climateReferenceMeanC: reference.meanC,
      climateReferenceStddevC: reference.stddevC,
      climateReferenceP10C: reference.p10C,
      climateReferenceP90C: reference.p90C,
      climateReferenceSamples: reference.sampleCount,
      temperatureAnomalyC: anomaly.deltaC,
      temperatureAnomalyZscore: anomaly.zscore,
      climatologyQualified:
        anomaly.zscore !== null &&
        Math.abs(anomaly.deltaC) >= 5 &&
        Math.abs(anomaly.zscore) >= 2,
    },
  } satisfies WorldEvent;
}

export async function enrichWeatherWithClimatology(
  events: WorldEvent[],
  options: Options = {},
): Promise<WorldEvent[]> {
  let created = 0;
  const output: WorldEvent[] = [];
  for (const event of events) {
    if (event.type !== "temperature_extreme" || typeof event.properties.cellId !== "string") {
      output.push(event);
      continue;
    }
    const kind = extremeKind(event);
    if (!kind) {
      output.push(event);
      continue;
    }
    const key = monthDay(event.startedAt);
    let reference = await getTemperatureReference(String(event.properties.cellId), kind, key);
    if (!reference && created < MAX_NEW_REFERENCES_PER_REFRESH) {
      reference = await fetchReference(event, kind, options);
      await saveTemperatureReference(reference);
      created++;
    }
    output.push(reference ? applyReference(event, reference) : event);
  }
  return output;
}
