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

export async function upsertWorldEvents(events: WorldEvent[], now = new Date()) {
  const client = await getPool().connect();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  try {
    await client.query("BEGIN");
    for (const event of events) {
      const fingerprint = eventFingerprint(event);
      const previous = await client.query(
        "SELECT fingerprint,payload FROM world_events WHERE id=$1 FOR UPDATE",
        [event.id],
      );
      if (previous.rowCount && previous.rows[0].fingerprint === fingerprint) {
        await client.query("UPDATE world_events SET refreshed_at=$2 WHERE id=$1", [event.id, now]);
        unchanged++;
        continue;
      }
      if (previous.rowCount) {
        await client.query(
          "INSERT INTO world_event_history(event_id,fingerprint,payload,captured_at) VALUES($1,$2,$3::jsonb,$4)",
          [event.id, previous.rows[0].fingerprint, JSON.stringify(previous.rows[0].payload), now],
        );
        updated++;
      } else {
        inserted++;
      }
      await client.query(
        `INSERT INTO world_events
          (id,provider,upstream_id,category,type,status,severity,latitude,longitude,started_at,updated_at,ended_at,fingerprint,payload,refreshed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
         ON CONFLICT(id) DO UPDATE SET
           category=excluded.category,type=excluded.type,status=excluded.status,severity=excluded.severity,
           latitude=excluded.latitude,longitude=excluded.longitude,started_at=excluded.started_at,
           updated_at=excluded.updated_at,ended_at=excluded.ended_at,fingerprint=excluded.fingerprint,
           payload=excluded.payload,refreshed_at=excluded.refreshed_at`,
        [
          event.id,
          event.source.provider,
          event.source.upstreamId,
          event.category,
          event.type,
          event.status,
          event.severity,
          event.location.latitude,
          event.location.longitude,
          event.startedAt,
          event.updatedAt,
          event.endedAt,
          fingerprint,
          JSON.stringify(event),
          now,
        ],
      );
    }
    await client.query("COMMIT");
    return { inserted, updated, unchanged };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listWorldEvents(options: {
  category?: EventCategory;
  type?: EventType;
  status?: "active" | "resolved";
  since?: Date;
  limit?: number;
} = {}) {
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
  const result = await getPool().query("SELECT payload FROM world_events WHERE id=$1", [id]);
  return result.rowCount ? (result.rows[0].payload as WorldEvent) : null;
}

export async function pruneWorldEventStorage(now = new Date(), historyDays = 30, resolvedDays = 35) {
  const history = await getPool().query(
    "DELETE FROM world_event_history WHERE captured_at<$1::timestamptz-($2*interval '1 day')",
    [now, Math.max(1, historyDays)],
  );
  const resolved = await getPool().query(
    "DELETE FROM world_events WHERE status='resolved' AND COALESCE(ended_at,updated_at)<$1::timestamptz-($2*interval '1 day')",
    [now, Math.max(1, resolvedDays)],
  );
  return { historyDeleted: history.rowCount ?? 0, eventsDeleted: resolved.rowCount ?? 0 };
}
