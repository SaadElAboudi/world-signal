import { getPool } from "./client";
import { getConfig } from "../server/config";
import { getStorageBudgetState, pruneApiUsageLedger } from "./resource-governor";
import { storageProfileForPressure } from "./storage-profile";
import { pruneWorldEventStorage } from "./world-events";

/**
 * Compact storage is pressure-aware. The free hosted database currently has a 1 GiB disk budget,
 * so retention contracts automatically before storage exhaustion instead of relying on manual cleanup.
 */
export async function maintainCompactStorage(now = new Date()) {
  const config = getConfig();
  const storage = await getStorageBudgetState();
  const profile = storageProfileForPressure(storage.pressure, {
    firmsRawRetentionHours: config.firmsRawRetentionHours,
    firmsRawSamplesPerCellHour: config.firmsRawSamplesPerHour,
  });
  await pruneWorldEventStorage(now, profile.eventHistoryDays, profile.resolvedEventDays);
  await pruneApiUsageLedger(now, 45);

  if (!config.firmsRawRetentionHours)
    return { storage, profile };

  const pool = getPool();
  await pool.query(
    "DELETE FROM observations WHERE provider='usgs' AND occurred_at<$1::timestamptz-($2*interval '1 day')",
    [now, profile.observationDays],
  );
  await pool.query(
    "DELETE FROM observations WHERE provider='firms' AND occurred_at<$1::timestamptz-($2*interval '1 hour')",
    [now, profile.firmsRawRetentionHours],
  );
  await pool.query(
    "DELETE FROM fire_hourly WHERE hour_end<$1::timestamptz-($2*interval '1 day')",
    [now, profile.fireAggregateDays],
  );
  await pool.query(
    "DELETE FROM fire_hour_coverage WHERE hour_end<$1::timestamptz-($2*interval '1 day')",
    [now, profile.fireAggregateDays],
  );
  await pool.query(
    "DELETE FROM signals WHERE resolved_at<$1::timestamptz-($2*interval '1 day')",
    [now, profile.observationDays],
  );
  await pool.query(
    `DELETE FROM signal_evidence e USING (
      SELECT id,computed_at,row_number() OVER(PARTITION BY signal_id,date_trunc('day',computed_at) ORDER BY computed_at DESC,id DESC) AS rank
      FROM signal_evidence
    ) old
    WHERE e.id=old.id AND (
      old.computed_at<$1::timestamptz-($2*interval '1 day') OR
      (old.rank>1 AND old.computed_at<$1::timestamptz-interval '2 days')
    )`,
    [now, profile.observationDays],
  );
  await pool.query(
    "DELETE FROM provider_runs WHERE finished_at<$1::timestamptz-($2*interval '1 day')",
    [now, profile.providerRunDays],
  );
  return { storage, profile };
}
