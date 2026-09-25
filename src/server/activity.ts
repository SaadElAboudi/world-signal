import type { Observation } from "../providers/contract";
import type { WorldSignal } from "../core/types";
import { getPool } from "../database/client";
import { activityAssessment } from "../signals/activity";
import { assessSignal } from "../signals/assessment";
import { errorCode, log } from "./log";
export function rowObservation(row: Record<string, unknown>): Observation {
  return {
    id: String(row.id),
    provider: String(row.provider),
    upstreamId: String(row.upstream_id),
    type: row.type as Observation["type"],
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
export async function computeActivitySignals(now = new Date()) {
  const client = await getPool().connect();
  let locked = false;
  let count = 0;
  try {
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtext('world-signal:activity')) AS acquired",
      )
    ).rows[0].acquired;
    if (!locked) return;
    for (const provider of ["ioda"]) {
      const last = await client.query(
        "SELECT * FROM provider_runs WHERE provider=$1 ORDER BY started_at DESC LIMIT 1",
        [provider],
      );
      if (last.rows[0]?.status !== "success") continue;
      const rows = await client.query(
        "SELECT * FROM observations WHERE provider=$1 AND active AND occurred_at>$2::timestamptz-interval '35 days' AND occurred_at<=$2 ORDER BY occurred_at,id",
        [provider, now],
      );
      const scopes = await client.query(
        "SELECT * FROM provider_scopes WHERE provider=$1",
        [provider],
      );
      const byScope = new Map<string, Observation[]>();
      for (const row of rows.rows) {
        const o = rowObservation(row);
        const scope = String(
          provider === "ioda" ? o.properties.countryCode : o.cellId,
        );
        if (
          provider === "ioda" &&
          !scopes.rows.find((s) => s.scope_id === scope && s.ok)
        )
          continue;
        const list = byScope.get(scope) ?? [];
        list.push(o);
        byScope.set(scope, list);
      }
      const previous = (
        await client.query(
          "SELECT payload FROM signals WHERE provider=$1 AND resolved_at IS NULL",
          [provider],
        )
      ).rows.map((r) => r.payload as WorldSignal);
      await client.query("BEGIN");
      try {
        for (const [scope, observations] of byScope) {
          const current = observations.at(-1)!;
          const assessment = activityAssessment(current, observations, now);
          if (!assessment.eligible) continue;
          const prior = previous.find((s) => s.scopeKey === scope);
          let signal: WorldSignal | undefined;
          if (assessment.signal) {
            signal = {
              ...assessment.signal,
              ...(prior
                ? {
                    id: prior.id,
                    startedAt: prior.startedAt,
                    status: "active" as const,
                  }
                : {}),
            };
          } else if (prior && prior.timestamp !== current.timestamp) {
            signal = {
              ...prior,
              updatedAt: now.toISOString(),
              timestamp: current.timestamp,
              sourceAsOf: current.timestamp,
              status: prior.status === "recovering" ? "resolved" : "recovering",
              observedValue: current.value!,
              expectedValue: assessment.baseline.expected,
              deviation: assessment.baseline.deviation,
              description:
                "Measurements have returned inside the configured anomaly threshold. Resolution requires two distinct usable observations.",
              evidence: prior.evidence
                ? {
                    ...prior.evidence,
                    windowEnd: current.timestamp,
                    observationIds: [current.id],
                  }
                : undefined,
            };
          }
          if (!signal) continue;
          signal = assessSignal(signal, now);
          await client.query(
            `INSERT INTO signals(id,provider,type,kind,severity,latitude,longitude,observed_at,started_at,updated_at,confidence,payload,resolved_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(id) DO UPDATE SET severity=EXCLUDED.severity,observed_at=EXCLUDED.observed_at,updated_at=EXCLUDED.updated_at,confidence=EXCLUDED.confidence,payload=EXCLUDED.payload,resolved_at=EXCLUDED.resolved_at`,
            [
              signal.id,
              provider,
              signal.type,
              signal.kind,
              signal.severity,
              signal.latitude,
              signal.longitude,
              signal.timestamp,
              signal.startedAt,
              now,
              signal.confidence,
              JSON.stringify(signal),
              signal.status === "resolved" ? now : null,
            ],
          );
          await client.query(
            "INSERT INTO signal_evidence(signal_id,computed_at,evidence) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [signal.id, now, JSON.stringify(signal.evidence)],
          );
          count++;
        }
        await client.query(
          "UPDATE provider_runs SET analysed_at=$2,analysis_error=NULL WHERE id=$1",
          [last.rows[0].id, now],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        await client.query(
          "UPDATE provider_runs SET analysis_error=$2 WHERE id=$1",
          [last.rows[0].id, errorCode(error)],
        );
        throw error;
      }
    }
    log("activity.compute.completed", { signals: count });
  } finally {
    if (locked)
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('world-signal:activity'))",
      );
    client.release();
  }
}
