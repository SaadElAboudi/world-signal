import { getPool } from "./client";
import { getConfig } from "../server/config";
import { pruneWorldEventStorage } from "./world-events";

function positiveEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Compact-storage profile tuned for a 1 GB managed PostgreSQL free tier. */
export async function maintainCompactStorage(now = new Date()) {
  const eventHistoryDays = positiveEnv("WORLD_EVENT_HISTORY_DAYS", 14);
  const resolvedEventDays = positiveEnv("WORLD_EVENT_RESOLVED_DAYS", 21);
  const observationDays = positiveEnv("OBSERVATION_RETENTION_DAYS", 21);
  const signalDays = positiveEnv("SIGNAL_RETENTION_DAYS", 21);
  const evidenceDays = positiveEnv("SIGNAL_EVIDENCE_RETENTION_DAYS", 21);
  const providerRunDays = positiveEnv("PROVIDER_RUN_RETENTION_DAYS", 21);
  const events = await pruneWorldEventStorage(now, eventHistoryDays, resolvedEventDays);
  const result = {
    ...events,
    observationsDeleted: 0,
    signalsDeleted: 0,
    evidenceDeleted: 0,
    providerRunsDeleted: 0,
  };
  if (!getConfig().firmsRawRetentionHours) return result;
  const pool = getPool();
  const observations = await pool.query(
    "DELETE FROM observations WHERE provider='usgs' AND occurred_at<$1::timestamptz-($2*interval '1 day')",
    [now, observationDays],
  );
  const signals = await pool.query(
    "DELETE FROM signals WHERE resolved_at<$1::timestamptz-($2*interval '1 day')",
    [now, signalDays],
  );
  const evidence = await pool.query(
    `DELETE FROM signal_evidence e USING (
      SELECT id,computed_at,row_number() OVER(PARTITION BY signal_id,date_trunc('day',computed_at) ORDER BY computed_at DESC,id DESC) AS rank
      FROM signal_evidence
    ) old WHERE e.id=old.id AND (old.computed_at<$1::timestamptz-($2*interval '1 day') OR (old.rank>1 AND old.computed_at<$1::timestamptz-interval '2 days'))`,
    [now, evidenceDays],
  );
  const providerRuns = await pool.query(
    "DELETE FROM provider_runs WHERE finished_at<$1::timestamptz-($2*interval '1 day')",
    [now, providerRunDays],
  );
  result.observationsDeleted = observations.rowCount ?? 0;
  result.signalsDeleted = signals.rowCount ?? 0;
  result.evidenceDeleted = evidence.rowCount ?? 0;
  result.providerRunsDeleted = providerRuns.rowCount ?? 0;
  return result;
}
