import "./env";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getPool, closePool } from "../src/database/client";
export async function migrate() {
  const client = await getPool().connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('world-signal:migrate'))",
    );
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("src/database/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(`src/database/migrations/${name}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error("Applied migration has changed");
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
      console.log(`Applied ${name}`);
    }
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext('world-signal:migrate'))",
    );
    client.release();
  }
}
if (process.argv[1]?.endsWith("migrate.ts"))
  migrate()
    .then(closePool)
    .catch(async () => {
      console.error(
        "Migration failed. Check database availability and migration checksums.",
      );
      await closePool();
      process.exitCode = 1;
    });
