import type { PoolClient } from "pg";
import type { Observation } from "../providers/contract";
import type { WorldSignal } from "../core/types";
import { getPool } from "../database/client";
import { AdsbLolProvider } from "../providers/adsblol";
import { matchedActivityBaseline } from "../signals/matched-baseline";
import { aviationDisruption } from "../signals/aviation";
import { ingest } from "./ingestion";
import { log } from "./log";

function rowToObservation(row: Record<string, unknown>): Observation {
  return {
    id: String(row.id),
    provider: String(row.provider),
    upstreamId: String(row.upstream_id),
    type: "aviation",
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    timestamp: (row.occurred_at as Date).toISOString(),
    sourceUpdatedAt: (row.source_updated_at as Date).toISOString(),
    value: row.value === null ? null : Number(row.value),
    cellId: String(row.cell_id),
    quality: Number(row.quality),
    sourceUrl: String(row.source_url),
    properties: row.properties as Record<string, unknown>,
    active: Boolean(row.active),
  };
}

async function saveSignals(
  client: PoolClient,
  signals: WorldSignal[],
  recoverable: string[],
  now: Date,
) {
  await client.query("BEGIN");
  try {
    const payloads = JSON.stringify(signals);
    await client.query(
      `INSERT INTO signals(id,provider,type,kind,severity,latitude,longitude,observed_at,started_at,updated_at,confidence,payload)
       SELECT s->>'id','adsblol',s->>'type',s->>'kind',s->>'severity',(s->>'latitude')::float8,(s->>'longitude')::float8,(s->>'timestamp')::timestamptz,(s->>'startedAt')::timestamptz,$2,(s->>'confidence')::float8,s
       FROM jsonb_array_elements($1::jsonb) s
       ON CONFLICT(id) DO UPDATE SET severity=EXCLUDED.severity,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,observed_at=EXCLUDED.observed_at,updated_at=EXCLUDED.updated_at,resolved_at=NULL,confidence=EXCLUDED.confidence,payload=EXCLUDED.payload`,
      [payloads, now],
    );
    await client.query(
      `INSERT INTO signal_evidence(signal_id,computed_at,evidence)
       SELECT s->>'id',$2,s->'evidence' FROM jsonb_array_elements($1::jsonb) s
       WHERE (SELECT evidence FROM signal_evidence WHERE signal_id=s->>'id' ORDER BY computed_at DESC LIMIT 1) IS DISTINCT FROM s->'evidence'
       ON CONFLICT DO NOTHING`,
      [payloads, now],
    );
    await client.query(
      `UPDATE signals SET resolved_at=$2,updated_at=$2,payload=jsonb_set(payload,'{status}','"resolved"')
       WHERE provider='adsblol' AND resolved_at IS NULL AND id=ANY($1::text[])`,
      [recoverable, now],
    );
    await client.query(
      "UPDATE provider_runs SET analysed_at=$1,analysis_error=NULL WHERE id=(SELECT id FROM provider_runs WHERE provider='adsblol' AND status='success' ORDER BY finished_at DESC LIMIT 1)",
      [now],
    );
    await client.query(
      "DELETE FROM observations WHERE provider='adsblol' AND occurred_at < $1",
      [new Date(now.getTime() - 35 * 86_400_000)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function computeAviationSignals(now = new Date()) {
  const client = await getPool().connect();
  let locked = false;
  try {
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtext('world-signal:aviation-analysis')) AS acquired",
      )
    ).rows[0].acquired;
    if (!locked) return { status: "locked" as const, regions: 0, signals: 0 };
    const result = await client.query(
      `SELECT * FROM observations
       WHERE provider='adsblol' AND active AND occurred_at >= $1
       ORDER BY occurred_at ASC,id ASC`,
      [new Date(now.getTime() - 35 * 86_400_000)],
    );
    const observations = result.rows.map(rowToObservation);
    const bySeries = new Map<string, Observation[]>();
    for (const observation of observations) {
      const key = observation.properties.seriesKey;
      if (typeof key !== "string") continue;
      const series = bySeries.get(key) ?? [];
      series.push(observation);
      bySeries.set(key, series);
    }
    const signals: WorldSignal[] = [];
    const recoverable: string[] = [];
    for (const series of bySeries.values()) {
      const current = series[series.length - 1];
      if (!current) continue;
      const signal = aviationDisruption(current, series.slice(0, -1), now);
      if (signal) signals.push(signal);
      else {
        const baseline = matchedActivityBaseline(current, series.slice(0, -1), {
          now,
          match: "hour-and-day-kind",
          minSamples: 7,
          maxAgeMinutes: 45,
        });
        if (
          baseline.available &&
          baseline.expected !== null &&
          baseline.expected >= 5 &&
          baseline.deviation !== null &&
          baseline.deviation > -40
        )
          recoverable.push(
            `adsblol:disruption:${String(current.properties.seriesKey ?? current.cellId)}`,
          );
      }
    }
    await saveSignals(client, signals, recoverable, now);
    log("aviation.analysis.completed", {
      regions: bySeries.size,
      signals: signals.length,
    });
    return {
      status: "success" as const,
      regions: bySeries.size,
      signals: signals.length,
    };
  } finally {
    if (locked)
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('world-signal:aviation-analysis'))",
      );
    client.release();
  }
}

export async function refreshAviation(now = new Date()) {
  if (process.env.ADSB_LOL_ENABLED === "false")
    return { status: "disabled" as const, regions: 0, signals: 0 };
  const result = await ingest(new AdsbLolProvider(), false, now);
  if (result.status !== "success")
    return { status: result.status, regions: 0, signals: 0 };
  return computeAviationSignals(now);
}
