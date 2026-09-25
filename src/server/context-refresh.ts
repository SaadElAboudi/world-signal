import { getPool } from "../database/client";
import { getStorageBudgetState } from "../database/resource-governor";
import { storageProfileForPressure } from "../database/storage-profile";
import { pruneInvestigationHistory } from "../database/investigations";
import { getConfig } from "./config";
import { log, errorCode } from "./log";
import { refreshSignalInvestigation } from "./context";
import { getCorrelatedEventInvestigation } from "./context";
import { synchronizeStories } from "../database/stories";
import type { CorrelatedEvent } from "../correlations/types";
import type { WorldSignal } from "../core/types";

export interface ContextRefreshResult {
  status: "success" | "skipped";
  attempted: number;
  refreshed: number;
  failed: number;
  prunedHistory: number;
}

export async function refreshRecentInvestigations(
  options: { limit?: number; lookbackHours?: number } = {},
): Promise<ContextRefreshResult> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 12));
  const lookbackHours = Math.max(1, Math.min(168, options.lookbackHours ?? 24));
  const client = await getPool().connect();
  let locked = false;
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtext('world-signal:context-refresh')) AS locked",
    );
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) {
      return { status: "skipped", attempted: 0, refreshed: 0, failed: 0, prunedHistory: 0 };
    }

    const candidates = await client.query(
      `SELECT s.id
         FROM signals s
         LEFT JOIN context_investigations ci
           ON ci.subject_type='signal' AND ci.subject_id=s.id
        WHERE s.resolved_at IS NULL
          AND s.observed_at >= now() - ($1 * interval '1 hour')
          AND (ci.subject_id IS NULL OR ci.expires_at <= now())
        ORDER BY s.severity DESC, s.observed_at DESC
        LIMIT $2`,
      [lookbackHours, limit],
    );

    let refreshed = 0;
    let failed = 0;
    for (const row of candidates.rows) {
      try {
        const result = await refreshSignalInvestigation(row.id);
        if (result) refreshed += 1;
      } catch (error) {
        failed += 1;
        log("context.refresh.signal.failed", { signalId: row.id, code: errorCode(error) });
      }
    }

    // Stories are only enriched when an existing correlation justifies a context lookup.
    // This keeps contextual retrieval bounded and never turns a provider failure into
    // an "unexplained" claim.
    const correlated = await client.query(
      `SELECT payload FROM correlated_events WHERE status='active' ORDER BY updated_at DESC LIMIT 2`,
    );
    for (const row of correlated.rows) {
      try {
        const event = row.payload as CorrelatedEvent;
        const members = await client.query(
          "SELECT payload FROM signals WHERE id=ANY($1::text[])",
          [event.signalIds],
        );
        await getCorrelatedEventInvestigation(
          event,
          members.rows.map((member) => member.payload as WorldSignal),
        );
      } catch (error) {
        failed += 1;
        log("context.refresh.correlation.failed", { code: errorCode(error) });
      }
    }
    await synchronizeStories();

    const storage = await getStorageBudgetState();
    const config = getConfig();
    const profile = storageProfileForPressure(storage.pressure, {
      firmsRawRetentionHours: config.firmsRawRetentionHours,
      firmsRawSamplesPerCellHour: config.firmsRawSamplesPerHour,
    });
    const prunedHistory = await pruneInvestigationHistory(profile.eventHistoryDays);
    return {
      status: "success",
      attempted: candidates.rowCount ?? 0,
      refreshed,
      failed,
      prunedHistory,
    };
  } finally {
    if (locked) {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('world-signal:context-refresh'))",
      );
    }
    client.release();
  }
}
