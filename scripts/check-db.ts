import "./env";
import { getPool, closePool } from "../src/database/client";
import { getConfig } from "../src/server/config";
import { readdir } from "node:fs/promises";

// Read-only deployment diagnostic. Never print connection strings or exception messages.
async function main() {
  const url = getConfig().databaseUrl;
  if (!url) {
    console.error(
      "DATABASE_NOT_CONFIGURED: set DATABASE_URL to the hosted PostgreSQL connection string.",
    );
    process.exitCode = 1;
    return;
  }
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol))
      throw new Error();
    hostname = parsed.hostname;
  } catch {
    console.error(
      "DATABASE_URL_INVALID: expected a PostgreSQL connection string.",
    );
    process.exitCode = 1;
    return;
  }
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname))
    console.log(
      "LOCAL_DATABASE: this address works locally; it does not connect Vercel to your Mac.",
    );
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    console.log("DATABASE_CONNECTED");
    const tables = [
      "schema_migrations",
      "observations",
      "signals",
      "signal_evidence",
      "provider_runs",
      "provider_registry",
    ];
    const missing: string[] = [];
    for (const table of tables) {
      const result = await pool.query("SELECT to_regclass($1) AS relation", [
        table,
      ]);
      if (!result.rows[0].relation) missing.push(table);
    }
    if (missing.length) {
      console.error(
        `SCHEMA_INCOMPLETE: missing ${missing.join(", ")}. Run db:migrate against this database.`,
      );
      process.exitCode = 1;
      return;
    }
    const applied = new Set(
      (await pool.query("SELECT name FROM schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );
    const pending = (await readdir("src/database/migrations")).filter(
      (name) => name.endsWith(".sql") && !applied.has(name),
    );
    if (pending.length) {
      console.error(
        `MIGRATIONS_PENDING: ${pending.join(", ")}. Run db:migrate.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log("SCHEMA_READY");

    const size = await pool.query(
      "SELECT pg_database_size(current_database())::bigint AS bytes",
    );
    const bytes = Number(size.rows[0]?.bytes ?? 0);
    console.log(
      JSON.stringify({
        databaseMegabytes: Number((bytes / 1024 / 1024).toFixed(1)),
        freeTierReferenceMegabytes: 1024,
        softBudgetMegabytes: Number(process.env.DB_SOFT_LIMIT_MB || 650),
        hardBudgetMegabytes: Number(process.env.DB_HARD_LIMIT_MB || 800),
      }),
    );
    const largest = await pool.query(
      `SELECT relname AS table_name,pg_total_relation_size(relid)::bigint AS bytes
       FROM pg_catalog.pg_statio_user_tables
       ORDER BY pg_total_relation_size(relid) DESC
       LIMIT 8`,
    );
    for (const row of largest.rows)
      console.log(
        JSON.stringify({
          table: row.table_name,
          megabytes: Number((Number(row.bytes) / 1024 / 1024).toFixed(1)),
        }),
      );

    const runs = await pool.query(
      "SELECT provider,max(finished_at) FILTER (WHERE status='success') AS last_collection,max(analysed_at) AS last_analysis FROM provider_runs GROUP BY provider ORDER BY provider",
    );
    for (const provider of ["usgs", "firms"]) {
      const run = runs.rows.find((r) => r.provider === provider);
      console.log(
        JSON.stringify({
          provider,
          lastCollection: run?.last_collection ?? null,
          lastAnalysis: run?.last_analysis ?? null,
        }),
      );
      if (!run?.last_collection)
        console.log(
          `INGESTION_REQUIRED: run ingest:${provider} -- --history, then keep the worker running.`,
        );
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    const labels: Record<string, string> = {
      "28P01": "DATABASE_AUTHENTICATION_FAILED",
      "28000": "DATABASE_AUTHENTICATION_FAILED",
      "3D000": "DATABASE_DOES_NOT_EXIST",
      "42501": "DATABASE_PERMISSION_DENIED",
      ECONNREFUSED: "DATABASE_CONNECTION_REFUSED",
      ENOTFOUND: "DATABASE_HOST_NOT_FOUND",
      ETIMEDOUT: "DATABASE_CONNECTION_TIMEOUT",
    };
    console.error(labels[code] ?? "DATABASE_CONNECTION_OR_QUERY_FAILED");
    console.error(
      "Check the connection string, TLS settings, network access and database permissions. Credentials are not printed.",
    );
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
main().catch(() => {
  console.error("DATABASE_CHECK_FAILED: check environment configuration.");
  process.exitCode = 1;
});
