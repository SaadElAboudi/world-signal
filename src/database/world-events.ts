import { createHash } from "node:crypto";
import type { EventCategory, EventType, WorldEvent } from "../events/types";
import { getPool } from "./client";

function eventFingerprint(event: WorldEvent) {
  const semantic = {
    title: event.title,
    description: event.description,
    status: event.status,
    severity: event.severity,
    confidence: event.confidence,
    startedAt: event.startedAt,
    updatedAt: event.updatedAt,
    endedAt: event.endedAt,
    location: event.location,
    magnitude: event.magnitude,
    source: event.source,
    secondarySources: event.secondarySources,
  };
  return createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
}

export async function upsertWorldEvents(
  events: WorldEvent[],
  now = new Date(),
) {
  const client = await getPool().connect();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  try {
    await client.query("BEGIN");
    const unique = [
      ...new Map(events.map((event) => [event.id, event])).values(),
    ];
    const previous = await client.query(
      "SELECT id,fingerprint,payload FROM world_events WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE",
      [unique.map((event) => event.id)],
    );
    const existing = new Map(previous.rows.map((row) => [row.id, row]));
    const changes = [];
    const history = [];
    const unchangedIds = [];
    for (const event of unique) {
      const fingerprint = eventFingerprint(event);
      const old = existing.get(event.id);
      if (old?.fingerprint === fingerprint) {
        unchangedIds.push(event.id);
        unchanged++;
      } else {
        if (old) {
          history.push({
            id: event.id,
            fingerprint: old.fingerprint,
            payload: old.payload,
          });
          updated++;
        } else inserted++;
        changes.push({ fingerprint, payload: event });
      }
    }
    if (history.length)
      await client.query(
        `INSERT INTO world_event_history(event_id,fingerprint,payload,captured_at)
       SELECT h->>'id',h->>'fingerprint',h->'payload',$2
       FROM jsonb_array_elements($1::jsonb) h`,
        [JSON.stringify(history), now],
      );
    if (changes.length)
      await client.query(
        `INSERT INTO world_events
       (id,provider,upstream_id,category,type,status,severity,latitude,longitude,started_at,updated_at,ended_at,fingerprint,payload,refreshed_at)
       SELECT p->>'id',p->'source'->>'provider',p->'source'->>'upstreamId',
         p->>'category',p->>'type',p->>'status',p->>'severity',
         (p->'location'->>'latitude')::float8,(p->'location'->>'longitude')::float8,
         (p->>'startedAt')::timestamptz,(p->>'updatedAt')::timestamptz,
         (p->>'endedAt')::timestamptz,fingerprint,p,$2
       FROM (SELECT c->'payload' AS p,c->>'fingerprint' AS fingerprint FROM jsonb_array_elements($1::jsonb) c) incoming
       ON CONFLICT(id) DO UPDATE SET
         category=EXCLUDED.category,type=EXCLUDED.type,status=EXCLUDED.status,severity=EXCLUDED.severity,
         latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,started_at=EXCLUDED.started_at,
         updated_at=EXCLUDED.updated_at,ended_at=EXCLUDED.ended_at,fingerprint=EXCLUDED.fingerprint,
         payload=EXCLUDED.payload,refreshed_at=EXCLUDED.refreshed_at`,
        [JSON.stringify(changes), now],
      );
    if (unchangedIds.length)
      await client.query(
        "UPDATE world_events SET refreshed_at=$2 WHERE id=ANY($1::text[])",
        [unchangedIds, now],
      );
    await client.query("COMMIT");
    return { inserted, updated, unchanged };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveMissingProviderEvents(
  provider: string,
  activeIds: string[],
  now = new Date(),
) {
  const result = await getPool().query(
    "SELECT payload FROM world_events WHERE provider=$1 AND status='active' AND NOT (id = ANY($2::text[]))",
    [provider, activeIds],
  );
  if (!result.rowCount) return 0;
  const endedAt = now.toISOString();
  const resolved = result.rows.map((row) => {
    const event = row.payload as WorldEvent;
    return {
      ...event,
      status: "resolved" as const,
      updatedAt: endedAt,
      endedAt,
      properties: {
        ...event.properties,
        resolvedBecauseMissingFromProvider: true,
      },
    } satisfies WorldEvent;
  });
  await upsertWorldEvents(resolved, now);
  return resolved.length;
}

export async function listWorldEvents(
  options: {
    category?: EventCategory;
    type?: EventType;
    status?: "active" | "resolved";
    since?: Date;
    limit?: number;
  } = {},
) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };
  if (options.category) add("category=?", options.category);
  if (options.type) add("type=?", options.type);
  if (options.status) add("status=?", options.status);
  if (options.since) add("updated_at>=?", options.since);
  const limit = Math.max(1, Math.min(1000, options.limit ?? 300));
  values.push(limit);
  const result = await getPool().query(
    `SELECT payload FROM world_events${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY CASE severity WHEN 'significant' THEN 4 WHEN 'elevated' THEN 3 WHEN 'notable' THEN 2 ELSE 1 END DESC,
              updated_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map((row) => row.payload as WorldEvent);
}

export async function getWorldEvent(id: string) {
  const result = await getPool().query(
    "SELECT payload FROM world_events WHERE id=$1",
    [id],
  );
  return result.rowCount ? (result.rows[0].payload as WorldEvent) : null;
}

export async function pruneWorldEventStorage(
  now = new Date(),
  historyDays = 30,
  resolvedDays = 35,
) {
  const history = await getPool().query(
    "DELETE FROM world_event_history WHERE captured_at<$1::timestamptz-($2*interval '1 day')",
    [now, Math.max(1, historyDays)],
  );
  const resolved = await getPool().query(
    "DELETE FROM world_events WHERE status='resolved' AND COALESCE(ended_at,updated_at)<$1::timestamptz-($2*interval '1 day')",
    [now, Math.max(1, resolvedDays)],
  );
  return {
    historyDeleted: history.rowCount ?? 0,
    eventsDeleted: resolved.rowCount ?? 0,
  };
}
