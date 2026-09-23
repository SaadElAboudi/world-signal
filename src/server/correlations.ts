import { getPool } from "../database/client";
import { correlate, reconcileEvents } from "../correlations/engine";
import { scopeForSignal } from "../correlations/geography";
import type {
  CorrelatedEvent,
  CorrelationInput,
  CorrelationWindow,
} from "../correlations/types";
import { getProviderHealth } from "./health";
export async function historicalInputs(
  asOf: Date,
  windowHours: number,
): Promise<CorrelationInput[]> {
  const result = await getPool().query(
    `SELECT * FROM (SELECT DISTINCT ON(signal_id) * FROM signal_versions WHERE recorded_at<=$1 ORDER BY signal_id,recorded_at DESC) versions WHERE observed_at >= $1::timestamptz-($2*interval '1 hour')`,
    [asOf, windowHours],
  );
  return result.rows.map((row) => ({
    signal: row.payload,
    providerId: row.provider,
    scope: scopeForSignal(row.payload),
    recordedAt: row.recorded_at.toISOString(),
    ...(row.resolved_at ? { endedAt: row.resolved_at.toISOString() } : {}),
  }));
}
export async function computeCorrelations(now = new Date()) {
  const client = await getPool().connect();
  let locked = false;
  try {
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtext('world-signal:correlations')) AS acquired",
      )
    ).rows[0].acquired;
    if (!locked) return;
    // Immutable compact versions: omit redundant baseline arrays from this index;
    // complete current evidence remains in signals + signal_evidence.
    await client.query(
      `INSERT INTO signal_versions(signal_id,recorded_at,provider,started_at,observed_at,resolved_at,payload)
   SELECT s.id,$1,s.provider,s.started_at,s.observed_at,s.resolved_at,(s.payload-'baseline'-'updatedAt'-'sourceAsOf') || '{"baseline":[]}'::jsonb
   FROM signals s WHERE s.observed_at>$1::timestamptz-interval '35 days'
   AND (SELECT payload FROM signal_versions v WHERE v.signal_id=s.id ORDER BY recorded_at DESC LIMIT 1) IS DISTINCT FROM ((s.payload-'baseline'-'updatedAt'-'sourceAsOf') || '{"baseline":[]}'::jsonb)
   ON CONFLICT DO NOTHING`,
      [now],
    );
    const inputs = await historicalInputs(now, 24);
    const all = [1, 6, 24].flatMap(
      (window) =>
        correlate(inputs, {
          asOf: now.toISOString(),
          windowHours: window as CorrelationWindow,
        }).events,
    );
    const chosen: CorrelatedEvent[] = [];
    for (const event of all.sort(
      (a, b) =>
        b.signalIds.length - a.signalIds.length ||
        a.windowHours - b.windowHours ||
        b.correlationStrength - a.correlationStrength,
    )) {
      if (
        chosen.some((other) =>
          event.signalIds.some((id) => other.signalIds.includes(id)),
        )
      )
        continue;
      chosen.push(event);
    }
    const previous = (
      await client.query(
        "SELECT payload FROM correlated_events WHERE status='active'",
      )
    ).rows.map((r) => r.payload as CorrelatedEvent);
    const health = await getProviderHealth(now);
    const events = reconcileEvents(
      previous,
      chosen,
      inputs,
      new Set(health.filter((p) => p.status === "healthy").map((p) => p.id!)),
      now.toISOString(),
    );
    await client.query("BEGIN");
    try {
      // Replace current index atomically; historical input versions support recomputation.
      await client.query(
        "UPDATE correlated_events SET status='resolved',payload=jsonb_set(payload,'{status}','\"resolved\"') WHERE status='active' AND NOT(id=ANY($1::text[]))",
        [events.map((e) => e.id)],
      );
      for (const event of events)
        await client.query(
          `INSERT INTO correlated_events(id,updated_at,started_at,window_end,status,payload) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(id) DO UPDATE SET updated_at=EXCLUDED.updated_at,window_end=EXCLUDED.window_end,status=EXCLUDED.status,payload=EXCLUDED.payload`,
          [
            event.id,
            event.updatedAt,
            event.startedAt,
            event.windowEnd,
            event.status,
            JSON.stringify(event),
          ],
        );
      await client.query(
        "INSERT INTO correlation_runs(computed_at,signal_count,event_count) VALUES($1,$2,$3)",
        [now, inputs.length, events.length],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return { signals: inputs.length, events: events.length };
  } finally {
    if (locked)
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('world-signal:correlations'))",
      );
    client.release();
  }
}
