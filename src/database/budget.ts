import { getPool } from "./client";

export type DatabaseBudgetState = "safe" | "warning" | "protect" | "emergency";

export interface DatabaseBudgetSnapshot {
  databaseBytes: number;
  databaseMb: number;
  limitMb: number;
  usageRatio: number;
  state: DatabaseBudgetState;
  lowPriorityAllowed: boolean;
  tables: Array<{ name: string; bytes: number; mb: number }>;
}

function numericEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function budgetState(ratio: number): DatabaseBudgetState {
  if (ratio >= 0.9) return "emergency";
  if (ratio >= 0.82) return "protect";
  if (ratio >= 0.7) return "warning";
  return "safe";
}

export async function getDatabaseBudgetSnapshot(): Promise<DatabaseBudgetSnapshot> {
  const pool = getPool();
  const limitMb = numericEnv("DATABASE_STORAGE_LIMIT_MB", 1024);
  const database = await pool.query(
    "SELECT pg_database_size(current_database())::bigint AS bytes",
  );
  const tableResult = await pool.query(
    `SELECT relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','m')
      ORDER BY bytes DESC
      LIMIT 12`,
  );
  const databaseBytes = Number(database.rows[0]?.bytes ?? 0);
  const databaseMb = databaseBytes / 1024 / 1024;
  const ratio = databaseMb / limitMb;
  const state = budgetState(ratio);
  return {
    databaseBytes,
    databaseMb: Number(databaseMb.toFixed(2)),
    limitMb,
    usageRatio: Number(ratio.toFixed(4)),
    state,
    lowPriorityAllowed: state === "safe" || state === "warning",
    tables: tableResult.rows.map((row) => {
      const bytes = Number(row.bytes ?? 0);
      return {
        name: String(row.name),
        bytes,
        mb: Number((bytes / 1024 / 1024).toFixed(2)),
      };
    }),
  };
}

export async function lowPriorityStorageAllowed() {
  return (await getDatabaseBudgetSnapshot()).lowPriorityAllowed;
}
