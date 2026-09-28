import type {
  EventCategory,
  EventProvider,
  EventType,
  WorldEvent,
} from "../events/types";
import { EonetEventProvider } from "../events/providers/eonet";
import { OpenMeteoExtremeWeatherProvider } from "../events/providers/open-meteo";
import { OpenMeteoMarineProvider } from "../events/providers/open-meteo-marine";
import { IodaInternetOutageProvider } from "../events/providers/ioda";
import { NoaaSpaceWeatherProvider } from "../events/providers/noaa-space-weather";
import { NoaaTsunamiProvider } from "../events/providers/noaa-tsunami";
import { getPool } from "../database/client";
import { enrichWeatherWithClimatology } from "./climate";
import { collectionGuard, type BudgetedProvider } from "./resource-budget";
import { DataError } from "./log";
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

function emptyResult(
  provider: string,
  status: "disabled" | "budget_limited" | "skipped" | "failed",
) {
  return {
    provider,
    status,
    received: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    resolved: 0,
  } as const;
}

function providerPause(error: unknown) {
  if (!(error instanceof DataError)) return null;
  if (error.code === "api_budget_exhausted") return "budget_limited" as const;
  if (["provider_cooldown", "upstream_http_429", "rate_limited"].includes(error.code))
    return "skipped" as const;
  return null;
}

async function withinBudget(provider: BudgetedProvider, now?: Date) {
  const guard = await collectionGuard(provider, { now });
  return guard.allowed ? null : emptyResult(provider, "budget_limited");
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
    if (!lock.rows[0]?.locked) return emptyResult(provider.id, "skipped");
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
  const limited = await withinBudget("eonet", options.now);
  if (limited) return limited;
  return refreshProvider(new EonetEventProvider(), options);
}

export async function refreshWeatherWorldEvents(options: RefreshOptions = {}) {
  if (process.env.OPEN_METEO_ENABLED !== "true")
    return emptyResult("open-meteo", "disabled");
  const limited = await withinBudget("open-meteo", options.now);
  if (limited) return limited;
  const endpoint = process.env.OPEN_METEO_ENDPOINT || undefined;
  const archiveEndpoint = process.env.OPEN_METEO_ARCHIVE_ENDPOINT || undefined;
  const apiKey = process.env.OPEN_METEO_API_KEY || undefined;
  return refreshProvider(
    new OpenMeteoExtremeWeatherProvider({ endpoint, apiKey }),
    options,
    true,
    (events) =>
      enrichWeatherWithClimatology(events, {
        endpoint: archiveEndpoint,
        apiKey,
      }),
  );
}

export async function refreshMarineWorldEvents(options: RefreshOptions = {}) {
  if (process.env.OPEN_METEO_MARINE_ENABLED === "false")
    return emptyResult("open-meteo-marine", "disabled");
  const limited = await withinBudget("open-meteo", options.now);
  if (limited) return { ...limited, provider: "open-meteo-marine" };
  const endpoint = process.env.OPEN_METEO_MARINE_ENDPOINT || undefined;
  const apiKey = process.env.OPEN_METEO_API_KEY || undefined;
  try {
    return await refreshProvider(
      new OpenMeteoMarineProvider({ endpoint, apiKey }),
      options,
      true,
    );
  } catch (error) {
    const status = providerPause(error);
    if (status) return emptyResult("open-meteo-marine", status);
    throw error;
  }
}

export async function refreshInternetWorldEvents(options: RefreshOptions = {}) {
  if (process.env.IODA_ENABLED === "false")
    return emptyResult("ioda", "disabled");
  const limited = await withinBudget("ioda", options.now);
  if (limited) return limited;
  const endpoint = process.env.IODA_ENDPOINT || undefined;
  return refreshProvider(new IodaInternetOutageProvider({ endpoint }), {
    ...options,
    days: options.days ?? 90,
    limit: options.limit ?? 1000,
  });
}
export async function refreshTsunamiWorldEvents(options: RefreshOptions = {}) { return refreshProvider(new NoaaTsunamiProvider(), options, true); }
export async function refreshSpaceWeatherWorldEvents(options: RefreshOptions = {}) { return refreshProvider(new NoaaSpaceWeatherProvider(), options, true); }

export async function refreshAllWorldEvents(options: RefreshOptions = {}) {
  const results = [];
  for (const [name, refresh] of [
    [
      "eonet",
      () => refreshEonetWorldEvents({ ...options, days: options.days ?? 14 }),
    ],
    ["open-meteo", () => refreshWeatherWorldEvents(options)],
    ["ioda", () => refreshInternetWorldEvents(options)],
    ["noaa-tsunami", () => refreshTsunamiWorldEvents(options)],
    ["noaa-swpc", () => refreshSpaceWeatherWorldEvents(options)],
  ] as const) {
    try {
      results.push(await refresh());
    } catch (error) {
      results.push(emptyResult(name, providerPause(error) ?? "failed"));
    }
  }
  return {
    status: results.some((r) => r.status === "failed")
      ? ("partial" as const)
      : ("success" as const),
    providers: results,
  };
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
