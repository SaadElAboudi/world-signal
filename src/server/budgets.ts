import { getPool } from "../database/client";

const MIB = 1024 * 1024;

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const DEFAULT_DB_SOFT_LIMIT_BYTES = positiveInt(
  process.env.DB_SOFT_LIMIT_MB,
  650,
) * MIB;
export const DEFAULT_DB_HARD_LIMIT_BYTES = positiveInt(
  process.env.DB_HARD_LIMIT_MB,
  800,
) * MIB;

export type StorageBudgetState = "normal" | "soft_limit" | "hard_limit";

export async function storageBudget(now = new Date()) {
  const result = await getPool().query(
    "SELECT pg_database_size(current_database())::bigint AS bytes",
  );
  const bytes = Number(result.rows[0]?.bytes ?? 0);
  const softLimitBytes = DEFAULT_DB_SOFT_LIMIT_BYTES;
  const hardLimitBytes = Math.max(DEFAULT_DB_HARD_LIMIT_BYTES, softLimitBytes);
  const state: StorageBudgetState =
    bytes >= hardLimitBytes
      ? "hard_limit"
      : bytes >= softLimitBytes
        ? "soft_limit"
        : "normal";
  await getPool().query(
    `INSERT INTO storage_budget_snapshots(captured_at,database_bytes,soft_limit_bytes,hard_limit_bytes,state)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(captured_at) DO NOTHING`,
    [now, bytes, softLimitBytes, hardLimitBytes, state],
  );
  return {
    bytes,
    megabytes: Number((bytes / MIB).toFixed(1)),
    softLimitBytes,
    hardLimitBytes,
    state,
  };
}

export async function reserveApiCalls(
  provider: string,
  requested: number,
  dailyBudget: number,
  now = new Date(),
) {
  const units = Math.max(0, Math.floor(requested));
  const budget = Math.max(1, Math.floor(dailyBudget));
  if (!units) return { allowed: true, used: 0, budget };
  const usageDate = now.toISOString().slice(0, 10);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO api_usage_daily(provider,usage_date,request_count,updated_at)
       VALUES($1,$2,0,$3)
       ON CONFLICT(provider,usage_date) DO NOTHING`,
      [provider, usageDate, now],
    );
    const current = await client.query(
      "SELECT request_count FROM api_usage_daily WHERE provider=$1 AND usage_date=$2 FOR UPDATE",
      [provider, usageDate],
    );
    const used = Number(current.rows[0]?.request_count ?? 0);
    if (used + units > budget) {
      await client.query("COMMIT");
      return { allowed: false, used, budget };
    }
    const next = used + units;
    await client.query(
      "UPDATE api_usage_daily SET request_count=$3,updated_at=$4 WHERE provider=$1 AND usage_date=$2",
      [provider, usageDate, next, now],
    );
    await client.query("COMMIT");
    return { allowed: true, used: next, budget };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function pruneBudgetTelemetry(now = new Date()) {
  const [api, storage] = await Promise.all([
    getPool().query(
      "DELETE FROM api_usage_daily WHERE usage_date < ($1::date - interval '45 days')",
      [now],
    ),
    getPool().query(
      "DELETE FROM storage_budget_snapshots WHERE captured_at < ($1::timestamptz - interval '14 days')",
      [now],
    ),
  ]);
  return {
    apiRowsDeleted: api.rowCount ?? 0,
    storageRowsDeleted: storage.rowCount ?? 0,
  };
}
