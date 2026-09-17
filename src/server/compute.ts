import { getPool } from "../database/client";
import { getConfig } from "./config";
import { getProviderHealth } from "./health";
import {
  buildClusterSignals,
  individualEarthquake,
  type CellAggregate,
} from "../signals/engine";
import { mergeCoverage } from "../signals/baseline";
import type { Observation } from "../providers/contract";
import type { WorldSignal } from "../core/types";
import { errorCode, log } from "./log";
export async function computeSignals(now = new Date()) {
  const client = await getPool().connect();
  let locked = false;
  let activeProvider: string | null = null;
  try {
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtext('world-signal:compute')) AS acquired",
      )
    ).rows[0].acquired;
    if (!locked) return { status: "skipped" };
    const config = getConfig();
    const health = await getProviderHealth(now);
    let count = 0;
    for (const provider of ["usgs", "firms"] as const) {
      activeProvider = provider;
      const state = health.find((h) => h.id === provider);
      // A failing or stale feed cannot resolve existing signals or imply normal conditions.
      if (!state?.sourceAsOf || state.status !== "healthy") {
        log("baseline.skipped", {
          provider,
          reason: state?.status ?? "unavailable",
        });
        continue;
      }
      const fire = provider === "firms";
      const hours = fire ? 24 : 6;
      const interval = hours * 3600000;
      const end =
        Math.floor(
          (Math.min(now.getTime(), Date.parse(state.sourceAsOf)) -
            (fire ? config.firmsSettlementHours * 3600000 : 0)) /
            3600000,
        ) * 3600000;
      const coverageRows = await client.query(
        "SELECT coverage_start,coverage_end FROM provider_runs WHERE provider=$1 AND status='success' AND coverage_end>$2 ORDER BY coverage_start",
        [provider, new Date(end - 32 * 86400000)],
      );
      const coverage = mergeCoverage(
        coverageRows.rows.map((r) => ({
          start: r.coverage_start.getTime(),
          end: r.coverage_end.getTime(),
        })),
      );
      const aggregates = await client.query(
        `SELECT cell_id,floor(extract(epoch FROM ($2::timestamptz-occurred_at))/$3)::int AS bucket,count(*)::int AS count,avg(quality)::float8 AS mean_quality,sum(value)::float8 AS frp_total,count(value)::int AS frp_count,min(occurred_at) AS first_at,max(occurred_at) AS last_at,
        (array_agg(id ORDER BY occurred_at DESC) FILTER(WHERE occurred_at>$2::timestamptz-($3*interval '1 second')))[1:20] AS ids,
        count(*) FILTER(WHERE quality>=0.9)::int AS high,count(*) FILTER(WHERE quality>=0.5 AND quality<0.9)::int AS nominal,count(*) FILTER(WHERE quality<0.5)::int AS low
        FROM observations WHERE provider=$1 AND active AND occurred_at<=$2 AND occurred_at>$4 AND ${fire ? "quality>=0.5" : "value>=$5"} GROUP BY cell_id,bucket`,
        fire
          ? [
              provider,
              new Date(end),
              interval / 1000,
              new Date(end - 31 * 86400000),
            ]
          : [
              provider,
              new Date(end),
              interval / 1000,
              new Date(end - 31 * 86400000),
              config.quakeClusterMagnitude,
            ],
      );
      const normalized: CellAggregate[] = aggregates.rows.map((r) => ({
        ...r,
        first_at: r.first_at.toISOString(),
        last_at: r.last_at.toISOString(),
      }));
      const signals: WorldSignal[] = buildClusterSignals(normalized, {
        provider,
        end,
        now: now.getTime(),
        sourceAsOf: state.sourceAsOf,
        coverage,
        config,
      });
      log("baseline.calculated", {
        provider,
        cells: normalized.length,
        signals: signals.length,
      });
      if (!fire) {
        const events = await client.query(
          "SELECT * FROM observations WHERE provider='usgs' AND active AND occurred_at>$1 ORDER BY occurred_at DESC",
          [new Date(now.getTime() - 86400000)],
        );
        for (const row of events.rows) {
          const observation: Observation = {
            id: row.id,
            provider,
            upstreamId: row.upstream_id,
            type: "earthquake",
            latitude: row.latitude,
            longitude: row.longitude,
            timestamp: row.occurred_at.toISOString(),
            sourceUpdatedAt: row.source_updated_at.toISOString(),
            value: row.value,
            cellId: row.cell_id,
            quality: row.quality,
            sourceUrl: row.source_url,
            properties: row.properties,
            active: row.active,
          };
          const signal = individualEarthquake(observation, config, now);
          if (signal) signals.push(signal);
        }
      }
      await client.query("BEGIN");
      try {
        for (const signal of signals) {
          const result = await client.query(
            `INSERT INTO signals(id,provider,type,kind,severity,latitude,longitude,observed_at,started_at,updated_at,confidence,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET severity=EXCLUDED.severity,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,observed_at=EXCLUDED.observed_at,updated_at=EXCLUDED.updated_at,resolved_at=NULL,confidence=EXCLUDED.confidence,payload=EXCLUDED.payload RETURNING (xmax=0) AS inserted`,
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
            ],
          );
          await client.query(
            "INSERT INTO signal_evidence(signal_id,computed_at,evidence) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [signal.id, now, JSON.stringify(signal.evidence)],
          );
          log(result.rows[0].inserted ? "signal.created" : "signal.updated", {
            provider,
            id: signal.id,
          });
        }
        const resolved = await client.query(
          "UPDATE signals SET resolved_at=$2,updated_at=$2,payload=jsonb_set(payload,'{status}','\"resolved\"') WHERE provider=$1 AND resolved_at IS NULL AND NOT(id=ANY($3::text[])) RETURNING id",
          [provider, now, signals.map((s) => s.id)],
        );
        for (const row of resolved.rows)
          log("signal.resolved", { provider, id: row.id });
        await client.query(
          "UPDATE provider_runs SET analysed_at=$3,analysis_error=NULL WHERE provider=$1 AND status='success' AND source_as_of=$2",
          [provider, state.sourceAsOf, now],
        );
        await client.query("COMMIT");
        count += signals.length;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { status: "success", signals: count };
  } catch (error) {
    if (activeProvider)
      await client
        .query(
          "UPDATE provider_runs SET analysis_error=$2 WHERE id=(SELECT id FROM provider_runs WHERE provider=$1 AND status='success' ORDER BY finished_at DESC LIMIT 1)",
          [activeProvider, errorCode(error)],
        )
        .catch(() => {});
    log("signals.compute.failed", { code: errorCode(error) });
    throw error;
  } finally {
    if (locked)
      await client
        .query("SELECT pg_advisory_unlock(hashtext('world-signal:compute'))")
        .catch(() => {});
    client.release();
  }
}
