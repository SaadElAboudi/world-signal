import { getPool } from "./client";

const GIB = 1024 ** 3;

export type StoragePressure = "normal" | "watch" | "conserve" | "critical";

export interface StorageBudgetState {
  bytes: number;
  quotaBytes: number;
  ratio: number;
  pressure: StoragePressure;
}

export interface ApiBudgetDecision {
  allowed: boolean;
  provider: string;
  requestedCalls: number;
  dailyUsed: number;
  monthlyUsed: number;
  dailyLimit: number;
  monthlyLimit: number;
  reason: "ok" | "daily_limit" | "monthly_limit";
}

function positiveNumberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function getStorageBudgetState(): Promise<StorageBudgetState> {
  const quotaBytes = positiveNumberEnv("DATABASE_STORAGE_QUOTA_BYTES", GIB);
  const result = await getPool().query(
    "SELECT pg_database_size(current_database())::bigint AS bytes",
  );
  const bytes = Number(result.rows[0]?.bytes ?? 0);
  const ratio = quotaBytes > 0 ? bytes / quotaBytes : 0;
  const pressure: StoragePressure =
    ratio >= 0.82
      ? "critical"
      : ratio >= 0.7
        ? "conserve"
        : ratio >= 0.55
          ? "watch"
          : "normal";
  return { bytes, quotaBytes, ratio, pressure };
}

export async function reserveApiBudget(
  provider: string,
  requestedCalls: number,
  limits: { daily: number; monthly: number },
  now = new Date(),
): Promise<ApiBudgetDecision> {
  if (
    ![requestedCalls, limits.daily, limits.monthly].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw new Error("Invalid API budget");
  const calls = requestedCalls;
  const client = await getPool().connect();
  const day = now.toISOString().slice(0, 10);
  const monthStart = `${day.slice(0, 7)}-01`;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `api-budget:${provider}`,
    ]);
    await client.query(
      `INSERT INTO api_usage_daily(provider,usage_date,calls,units)
       VALUES($1,$2,0,0)
       ON CONFLICT(provider,usage_date) DO NOTHING`,
      [provider, day],
    );
    const dailyResult = await client.query(
      "SELECT calls FROM api_usage_daily WHERE provider=$1 AND usage_date=$2 FOR UPDATE",
      [provider, day],
    );
    const monthlyResult = await client.query(
      `SELECT COALESCE(sum(calls),0)::bigint AS calls
       FROM api_usage_daily
       WHERE provider=$1 AND usage_date >= $2::date AND usage_date < $2::date + interval '1 month'`,
      [provider, monthStart],
    );
    const dailyUsed = Number(dailyResult.rows[0]?.calls ?? 0);
    const monthlyUsed = Number(monthlyResult.rows[0]?.calls ?? 0);
    const reason: ApiBudgetDecision["reason"] =
      dailyUsed + calls > limits.daily
        ? "daily_limit"
        : monthlyUsed + calls > limits.monthly
          ? "monthly_limit"
          : "ok";
    if (reason === "ok" && calls > 0) {
      await client.query(
        `UPDATE api_usage_daily
         SET calls=calls+$3, units=units+$3, updated_at=$4
         WHERE provider=$1 AND usage_date=$2`,
        [provider, day, calls, now],
      );
    }
    await client.query("COMMIT");
    return {
      allowed: reason === "ok",
      provider,
      requestedCalls: calls,
      dailyUsed,
      monthlyUsed,
      dailyLimit: limits.daily,
      monthlyLimit: limits.monthly,
      reason,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function pruneApiUsageLedger(now = new Date(), keepDays = 45) {
  const result = await getPool().query(
    "DELETE FROM api_usage_daily WHERE usage_date < $1::date-($2*interval '1 day')",
    [now, Math.max(32, keepDays)],
  );
  return result.rowCount ?? 0;
}

export async function getApiUsageSummary(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const monthStart = `${day.slice(0, 7)}-01`;
  const result = await getPool().query(
    `SELECT provider,
            COALESCE(sum(calls) FILTER (WHERE usage_date=$1::date),0)::bigint AS today,
            COALESCE(sum(calls) FILTER (WHERE usage_date >= $2::date),0)::bigint AS month
     FROM api_usage_daily
     WHERE usage_date >= $2::date
     GROUP BY provider
     ORDER BY provider`,
    [day, monthStart],
  );
  return result.rows.map((row) => ({
    provider: String(row.provider),
    today: Number(row.today),
    month: Number(row.month),
  }));
}
