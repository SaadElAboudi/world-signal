import { getPool } from "./client";
import { getConfig } from "../server/config";
import { pruneWorldEventStorage } from "./world-events";
import { pruneBudgetTelemetry, storageBudget } from "../server/budgets";

/**
 * Compact storage is adaptive. The normal free-tier profile already stays conservative;
 * soft/hard modes shorten non-critical history further before disk saturation.
 */
export async function maintainCompactStorage(now = new Date()) {
  const budget = await storageBudget(now);
  const profile =
    budget.state === "hard_limit"
      ? { eventHistoryDays: 3, resolvedDays: 7, signalDays: 7, runDays: 14 }
      : budget.state === "soft_limit"
        ? { eventHistoryDays: 7, resolvedDays: 14, signalDays: 14, runDays: 21 }
        : { eventHistoryDays: 14, resolvedDays: 21, signalDays: 21, runDays: 30 };

  await pruneWorldEventStorage(now, profile.eventHistoryDays, profile.resolvedDays);
  await pruneBudgetTelemetry(now);

  if (!getConfig().firmsRawRetentionHours) return budget;
  const pool = getPool();
  await pool.query(
    "DELETE FROM observations WHERE provider='usgs' AND occurred_at<$1::timestamptz-($2*interval '1 day')",
    [now, profile.signalDays],
  );
  await pool.query(
    "DELETE FROM observations WHERE provider='adsblol' AND occurred_at<$1::timestamptz-($2*interval '1 day')",
    [now, profile.signalDays],
  );
  await pool.query(
    "DELETE FROM signals WHERE resolved_at<$1::timestamptz-($2*interval '1 day')",
    [now, profile.signalDays],
  );
  await pool.query(
    `DELETE FROM signal_evidence e USING (
      SELECT id,computed_at,row_number() OVER(PARTITION BY signal_id,date_trunc('day',computed_at) ORDER BY computed_at DESC,id DESC) AS rank
      FROM signal_evidence
    ) old
    WHERE e.id=old.id
      AND (
        old.computed_at<$1::timestamptz-($2*interval '1 day')
        OR (old.rank>1 AND old.computed_at<$1::timestamptz-interval '2 days')
      )`,
    [now, profile.signalDays],
  );
  await pool.query(
    "DELETE FROM provider_runs WHERE finished_at<$1::timestamptz-($2*interval '1 day')",
    [now, profile.runDays],
  );
  return budget;
}
