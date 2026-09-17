import { getConfig } from "./config";
import { getPool } from "../database/client";
import { storeObservations } from "../database/observations";
import { UsgsProvider } from "../providers/usgs";
import { FirmsProvider } from "../providers/nasa-firms";
import type { ObservationProvider } from "../providers/contract";
import { DataError, errorCode, log } from "./log";
export const providers = [new UsgsProvider(), new FirmsProvider()];
export async function ingest(
  provider: ObservationProvider,
  history = false,
  now = new Date(),
  historical: { startDate?: string; days?: number } = {},
) {
  const client = await getPool().connect();
  let runId: number | undefined;
  let locked = false;
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [`world-signal:ingest:${provider.id}`],
    );
    locked = lock.rows[0].acquired;
    if (!locked) {
      log("provider.fetch.skipped", {
        provider: provider.id,
        reason: "locked",
      });
      return { status: "skipped" as const };
    }
    // Holding the provider lock proves older running entries no longer have a live collector.
    await client.query(
      "UPDATE provider_runs SET status='failed',finished_at=now(),error_code='interrupted' WHERE provider=$1 AND status='running'",
      [provider.id],
    );
    const run = await client.query(
      "INSERT INTO provider_runs(provider,status,history) VALUES($1,'running',$2) RETURNING id",
      [provider.id, history],
    );
    runId = run.rows[0].id;
    log("provider.fetch.started", { provider: provider.id, history });
    const raw = await provider.fetchRawData({ history, now, ...historical });
    const batch = provider.normalize(raw);
    await client.query(
      "UPDATE provider_runs SET records_received=$2,records_rejected=$3 WHERE id=$1",
      [runId, batch.received, batch.rejected],
    );
    if (batch.rejected) throw new DataError("malformed_records");
    log("observations.normalized", {
      provider: provider.id,
      count: batch.observations.length,
    });
    const result = await storeObservations(
      client,
      provider.id,
      batch,
      getConfig().firmsRawRetentionHours,
      getConfig().firmsRawSamplesPerHour,
    );
    let latest: string | null = null;
    for (const o of batch.observations)
      if (!latest || o.timestamp > latest) latest = o.timestamp;
    await client.query(
      "UPDATE provider_runs SET status='success',finished_at=now(),records_inserted=$2,records_updated=$3,coverage_start=$4,coverage_end=$5,source_as_of=$6,latest_observation_at=$7 WHERE id=$1",
      [
        runId,
        result.inserted,
        result.updated,
        batch.coverageStart,
        batch.coverageEnd,
        batch.sourceAsOf,
        latest,
      ],
    );
    log("provider.fetch.completed", {
      provider: provider.id,
      received: batch.received,
      inserted: result.inserted,
      updated: result.updated,
    });
    return { status: "success" as const, ...result };
  } catch (error) {
    const code = errorCode(error);
    const status = code === "missing_credentials" ? "unavailable" : "failed";
    if (runId)
      await client
        .query(
          "UPDATE provider_runs SET status=$2,finished_at=now(),error_code=$3 WHERE id=$1",
          [runId, status, code],
        )
        .catch(() => {});
    log("provider.fetch.failed", { provider: provider.id, code });
    return { status, code };
  } finally {
    if (locked)
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [
          `world-signal:ingest:${provider.id}`,
        ])
        .catch(() => {});
    client.release();
  }
}
