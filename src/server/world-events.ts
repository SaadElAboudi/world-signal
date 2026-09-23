import type { EventCategory, EventProvider, EventType, WorldEvent } from "../events/types";
import { EonetEventProvider } from "../events/providers/eonet";
import { OpenMeteoExtremeWeatherProvider } from "../events/providers/open-meteo";
import { OpenMeteoMarineProvider } from "../events/providers/open-meteo-marine";
import { IodaInternetOutageProvider } from "../events/providers/ioda";
import { EntsoeGridLoadProvider } from "../events/providers/entsoe";
import { getPool } from "../database/client";
import { lowPriorityStorageAllowed } from "../database/budget";
import { enrichWeatherWithClimatology } from "./climate";
import {
  getWorldEvent,
  listWorldEvents,
  resolveMissingProviderEvents,
  upsertWorldEvents,
} from "../database/world-events";

const CATEGORIES = new Set<EventCategory>([
  "natural_hazard",
  "climate",
  "environment",
  "infrastructure",
  "mobility",
  "earth_observation",
]);

type RefreshOptions = { now?: Date; days?: number; limit?: number };
type EventTransform = (events: WorldEvent[]) => Promise<WorldEvent[]>;

function integerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value)))
    : fallback;
}

async function refreshProvider(
  provider: EventProvider,
  options: RefreshOptions = {},
  resolveMissing = false,
  transform?: EventTransform,
) {
  const client = await getPool().connect();
  const lockName = `world-signal:events:${provider.id}`;
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [lockName],
    );
    if (!lock.rows[0]?.locked)
      return {
        provider: provider.id,
        status: "skipped" as const,
        received: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        resolved: 0,
      };
    try {
      const fetched = await provider.fetchEvents(options);
      const events = transform ? await transform(fetched) : fetched;
      const result = await upsertWorldEvents(events, options.now);
      const resolved = resolveMissing
        ? await resolveMissingProviderEvents(
            provider.id,
            events.map((event) => event.id),
            options.now,
          )
        : 0;
      return {
        provider: provider.id,
        status: "success" as const,
        received: events.length,
        ...result,
        resolved,
      };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
    }
  } finally {
    client.release();
  }
}

export async function refreshEonetWorldEvents(options: RefreshOptions = {}) {
  return refreshProvider(new EonetEventProvider(), options);
}

export async function refreshWeatherWorldEvents(options: RefreshOptions = {}) {
  if (process.env.OPEN_METEO_ENABLED !== "true")
    return {
      provider: "open-meteo",
      status: "disabled" as const,
      received: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      resolved: 0,
    };
  const endpoint = process.env.OPEN_METEO_ENDPOINT || undefined;
  const archiveEndpoint = process.env.OPEN_METEO_ARCHIVE_ENDPOINT || undefined;
  const apiKey = process.env.OPEN_METEO_API_KEY || undefined;
  const batchSize = integerEnv("OPEN_METEO_BATCH_SIZE", 40, 10, 50);
  const allowNewReferences = await lowPriorityStorageAllowed();
  return refreshProvider(
    new OpenMeteoExtremeWeatherProvider({ endpoint, apiKey, batchSize }),
    options,
    true,
    (events) =>
      enrichWeatherWithClimatology(events, {
        endpoint: archiveEndpoint,
        apiKey,
        allowNewReferences,
      }),
  );
}

export async function refreshMarineWorldEvents(options: RefreshOptions = {}) {
  if (process.env.OPEN_METEO_MARINE_ENABLED === "false")
    return {
      provider: "open-meteo-marine",
      status: "disabled" as const,
      received: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      resolved: 0,
    };
  const endpoint = process.env.OPEN_METEO_MARINE_ENDPOINT || undefined;
  const apiKey = process.env.OPEN_METEO_API_KEY || undefined;
  const batchSize = integerEnv("OPEN_METEO_MARINE_BATCH_SIZE", 24, 6, 25);
  return refreshProvider(
    new OpenMeteoMarineProvider({ endpoint, apiKey, batchSize }),
    options,
    true,
  );
}

export async function refreshInternetWorldEvents(options: RefreshOptions = {}) {
  if (process.env.IODA_ENABLED === "false")
    return {
      provider: "ioda",
      status: "disabled" as const,
      received: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      resolved: 0,
    };
  const endpoint = process.env.IODA_ENDPOINT || undefined;
  return refreshProvider(
    new IodaInternetOutageProvider({ endpoint }),
    { ...options, days: options.days ?? 90, limit: options.limit ?? 1000 },
  );
}

export async function refreshPowerWorldEvents(options: RefreshOptions = {}) {
  const token = process.env.ENTSOE_SECURITY_TOKEN;
  if (process.env.ENTSOE_ENABLED !== "true" || !token)
    return {
      provider: "entsoe",
      status: "disabled" as const,
      received: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      resolved: 0,
    };
  const endpoint = process.env.ENTSOE_ENDPOINT || undefined;
  const maxZonesPerRun = integerEnv("ENTSOE_MAX_ZONES_PER_RUN", 7, 1, 7);
  return refreshProvider(
    new EntsoeGridLoadProvider({ token, endpoint, maxZonesPerRun }),
    options,
    true,
  );
}

export async function refreshAllWorldEvents(options: RefreshOptions = {}) {
  const eonet = await refreshEonetWorldEvents({
    ...options,
    days: options.days ?? 14,
  });
  const weather = await refreshWeatherWorldEvents(options);
  const internet = await refreshInternetWorldEvents(options);
  return { status: "success" as const, providers: [eonet, weather, internet] };
}

export async function queryWorldEvents(params: URLSearchParams) {
  const categoryValue = params.get("category");
  const category =
    categoryValue && CATEGORIES.has(categoryValue as EventCategory)
      ? (categoryValue as EventCategory)
      : undefined;
  const type = (params.get("type") || undefined) as EventType | undefined;
  const statusValue = params.get("status");
  const status =
    statusValue === "active" || statusValue === "resolved"
      ? statusValue
      : undefined;
  const sinceRaw = params.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  const limitRaw = Number(params.get("limit") ?? 300);
  return listWorldEvents({
    category,
    type,
    status,
    ...(since && Number.isFinite(since.getTime()) ? { since } : {}),
    limit: Number.isFinite(limitRaw) ? limitRaw : 300,
  });
}

export { getWorldEvent };
