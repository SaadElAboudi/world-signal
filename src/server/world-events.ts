import type { EventCategory, EventProvider, EventType } from "../events/types";
import { EonetEventProvider } from "../events/providers/eonet";
import { OpenMeteoExtremeWeatherProvider } from "../events/providers/open-meteo";
import { getPool } from "../database/client";
import { getWorldEvent, listWorldEvents, upsertWorldEvents } from "../database/world-events";

const CATEGORIES = new Set<EventCategory>([
  "natural_hazard",
  "climate",
  "environment",
  "infrastructure",
  "mobility",
  "earth_observation",
]);

type RefreshOptions = { now?: Date; days?: number; limit?: number };

async function refreshProvider(provider: EventProvider, options: RefreshOptions = {}) {
  const client = await getPool().connect();
  const lockName = `world-signal:events:${provider.id}`;
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [lockName],
    );
    if (!lock.rows[0]?.locked)
      return { provider: provider.id, status: "skipped" as const, received: 0, inserted: 0, updated: 0, unchanged: 0 };
    try {
      const events = await provider.fetchEvents(options);
      const result = await upsertWorldEvents(events, options.now);
      return { provider: provider.id, status: "success" as const, received: events.length, ...result };
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
    return { provider: "open-meteo", status: "disabled" as const, received: 0, inserted: 0, updated: 0, unchanged: 0 };
  const endpoint = process.env.OPEN_METEO_ENDPOINT || undefined;
  const apiKey = process.env.OPEN_METEO_API_KEY || undefined;
  return refreshProvider(
    new OpenMeteoExtremeWeatherProvider({ endpoint, apiKey }),
    options,
  );
}

export async function refreshAllWorldEvents(options: RefreshOptions = {}) {
  const eonet = await refreshEonetWorldEvents({ ...options, days: options.days ?? 14 });
  const weather = await refreshWeatherWorldEvents(options);
  return { status: "success" as const, providers: [eonet, weather] };
}

export async function queryWorldEvents(params: URLSearchParams) {
  const categoryValue = params.get("category");
  const category = categoryValue && CATEGORIES.has(categoryValue as EventCategory)
    ? (categoryValue as EventCategory)
    : undefined;
  const type = (params.get("type") || undefined) as EventType | undefined;
  const statusValue = params.get("status");
  const status = statusValue === "active" || statusValue === "resolved" ? statusValue : undefined;
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
