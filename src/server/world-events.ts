import type { EventCategory, EventType } from "../events/types";
import { EonetEventProvider } from "../events/providers/eonet";
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

export async function refreshEonetWorldEvents(options: { now?: Date; days?: number; limit?: number } = {}) {
  const client = await getPool().connect();
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtext('world-signal:events:eonet')) AS locked",
    );
    if (!lock.rows[0]?.locked) return { status: "skipped" as const, received: 0, inserted: 0, updated: 0, unchanged: 0 };
    try {
      const provider = new EonetEventProvider();
      const events = await provider.fetchEvents(options);
      const result = await upsertWorldEvents(events, options.now);
      return { status: "success" as const, received: events.length, ...result };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('world-signal:events:eonet'))");
    }
  } finally {
    client.release();
  }
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
