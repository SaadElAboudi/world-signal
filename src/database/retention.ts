import { getPool } from "./client";
import { getConfig } from "../server/config";
import { pruneWorldEventStorage } from "./world-events";
/** Explicit compact-storage profile: keep current events, 30 days of event changes, and 35 days of resolved events. */
export async function maintainCompactStorage(now = new Date()) {
  await pruneWorldEventStorage(now, 30, 35);
  if (!getConfig().firmsRawRetentionHours) return;
  const pool = getPool();
  await pool.query(
    "DELETE FROM signal_versions WHERE recorded_at<$1::timestamptz-interval '35 days'",
    [now],
  );
  await pool.query(
    "DELETE FROM correlated_events WHERE window_end<$1::timestamptz-interval '35 days'",
    [now],
  );
  await pool.query(
    "DELETE FROM correlation_runs WHERE computed_at<$1::timestamptz-interval '35 days'",
    [now],
  );

  await pool.query(
    "DELETE FROM observations WHERE provider IN ('usgs','ioda','adsblol') AND occurred_at<$1::timestamptz-interval '35 days'",
    [now],
  );
  await pool.query(
    "DELETE FROM signals WHERE resolved_at<$1::timestamptz-interval '35 days'",
    [now],
  );
  await pool.query(
    `DELETE FROM signal_evidence e USING (
    SELECT id,computed_at,row_number() OVER(PARTITION BY signal_id,date_trunc('day',computed_at) ORDER BY computed_at DESC,id DESC) AS rank
    FROM signal_evidence
  ) old WHERE e.id=old.id AND (old.computed_at<$1::timestamptz-interval '35 days' OR (old.rank>1 AND old.computed_at<$1::timestamptz-interval '2 days'))`,
    [now],
  );
  await pool.query(
    "DELETE FROM provider_runs WHERE finished_at<$1::timestamptz-interval '40 days'",
    [now],
  );
}
