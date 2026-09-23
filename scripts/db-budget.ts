import "./env";
import { closePool, getPool } from "../src/database/client";

async function main() {
  const pool = getPool();
  const size = await pool.query(
    "SELECT pg_database_size(current_database())::bigint AS bytes",
  );
  const bytes = Number(size.rows[0]?.bytes ?? 0);
  const softMb = Number(process.env.DB_SOFT_LIMIT_MB || 650);
  const hardMb = Number(process.env.DB_HARD_LIMIT_MB || 800);
  const usedMb = Number((bytes / 1024 / 1024).toFixed(1));
  const state = usedMb >= hardMb ? "hard_limit" : usedMb >= softMb ? "soft_limit" : "normal";
  console.log(JSON.stringify({ usedMb, freeTierMb: 1024, softMb, hardMb, state }));

  const tables = await pool.query(
    `SELECT relname AS table_name,pg_total_relation_size(relid)::bigint AS bytes
     FROM pg_catalog.pg_statio_user_tables
     ORDER BY pg_total_relation_size(relid) DESC
     LIMIT 12`,
  );
  for (const row of tables.rows)
    console.log(
      JSON.stringify({
        table: row.table_name,
        megabytes: Number((Number(row.bytes) / 1024 / 1024).toFixed(1)),
      }),
    );

  const usage = await pool.query(
    `SELECT provider,usage_date,request_count
       FROM api_usage_daily
      WHERE usage_date >= current_date - interval '1 day'
      ORDER BY usage_date DESC,provider`,
  );
  for (const row of usage.rows)
    console.log(
      JSON.stringify({
        provider: row.provider,
        date: row.usage_date.toISOString().slice(0, 10),
        requests: Number(row.request_count),
      }),
    );
}

main()
  .catch(() => {
    console.error("DATABASE_BUDGET_CHECK_FAILED");
    process.exitCode = 1;
  })
  .finally(closePool);
