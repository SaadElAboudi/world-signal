import { getPool } from "./client";
import type { Investigation } from "../context/investigation";

export type InvestigationSubjectType = "signal" | "correlated_event";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export async function getPersistedInvestigation(
  subjectType: InvestigationSubjectType,
  subjectId: string,
  options: { allowStale?: boolean; now?: Date } = {},
): Promise<Investigation | null> {
  const now = options.now ?? new Date();
  const result = await getPool().query(
    `SELECT investigation,expires_at
       FROM context_investigations
      WHERE subject_type=$1 AND subject_id=$2`,
    [subjectType, subjectId],
  );
  if (!result.rowCount) return null;
  if (!options.allowStale && result.rows[0].expires_at.getTime() <= now.getTime()) return null;
  return result.rows[0].investigation as Investigation;
}

export async function saveInvestigation(
  subjectType: InvestigationSubjectType,
  investigation: Investigation,
  options: { now?: Date; ttlMs?: number } = {},
) {
  const now = options.now ?? new Date();
  const ttlMs = Math.max(60_000, options.ttlMs ?? DEFAULT_TTL_MS);
  const expiresAt = new Date(now.getTime() + ttlMs);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const previous = await client.query(
      `SELECT investigation,status,corroboration_status,retrieval_status
         FROM context_investigations
        WHERE subject_type=$1 AND subject_id=$2
        FOR UPDATE`,
      [subjectType, investigation.eventId],
    );
    if (previous.rowCount) {
      const prev = previous.rows[0];
      await client.query(
        `INSERT INTO context_investigation_history
          (subject_type,subject_id,investigation,status,corroboration_status,retrieval_status,captured_at)
         VALUES($1,$2,$3::jsonb,$4,$5,$6,$7)`,
        [
          subjectType,
          investigation.eventId,
          JSON.stringify(prev.investigation),
          prev.status,
          prev.corroboration_status,
          prev.retrieval_status,
          now,
        ],
      );
    }
    await client.query(
      `INSERT INTO context_investigations
        (subject_type,subject_id,investigation,status,corroboration_status,retrieval_status,created_at,refreshed_at,expires_at)
       VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(subject_type,subject_id) DO UPDATE SET
         investigation=excluded.investigation,
         status=excluded.status,
         corroboration_status=excluded.corroboration_status,
         retrieval_status=excluded.retrieval_status,
         refreshed_at=excluded.refreshed_at,
         expires_at=excluded.expires_at`,
      [
        subjectType,
        investigation.eventId,
        JSON.stringify(investigation),
        investigation.status,
        investigation.corroborationStatus,
        investigation.retrievalStatus,
        investigation.createdAt,
        now,
        expiresAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listInvestigationHistory(
  subjectType: InvestigationSubjectType,
  subjectId: string,
  limit = 20,
) {
  const result = await getPool().query(
    `SELECT investigation,captured_at
       FROM context_investigation_history
      WHERE subject_type=$1 AND subject_id=$2
      ORDER BY captured_at DESC
      LIMIT $3`,
    [subjectType, subjectId, Math.max(1, Math.min(100, limit))],
  );
  return result.rows.map((row) => ({
    investigation: row.investigation as Investigation,
    capturedAt: row.captured_at.toISOString(),
  }));
}

export async function pruneInvestigationHistory(retentionDays = 30) {
  const result = await getPool().query(
    `DELETE FROM context_investigation_history
      WHERE captured_at < now() - ($1 * interval '1 day')`,
    [Math.max(1, retentionDays)],
  );
  return result.rowCount ?? 0;
}
