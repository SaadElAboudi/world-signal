import { Pool } from "pg";
import { getConfig } from "../server/config";
import { DataError, log } from "../server/log";
const globalDb = globalThis as unknown as { worldSignalPool?: Pool };
export function getPool() {
  if (!globalDb.worldSignalPool) {
    const config = getConfig();
    let url = config.databaseUrl;
    if (!url) throw new DataError("database_not_configured");
    const ca = config.databaseSslCa?.replaceAll("\\n", "\n");
    if (ca) {
      const parsed = new URL(url);
      for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
        parsed.searchParams.delete(key);
      url = parsed.toString();
    }
    globalDb.worldSignalPool = new Pool({
      connectionString: url,
      max: config.databasePoolMax,
      ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 30000,
      statement_timeout: 120000,
      application_name: "world-signal",
      options: "-c timezone=UTC",
    });
    globalDb.worldSignalPool.on("connect", (client) => {
      client.on("error", () => log("database.client.connection.failed"));
    });
    globalDb.worldSignalPool.on("error", () =>
      log("database.connection.failed"),
    );
  }
  return globalDb.worldSignalPool;
}
export async function closePool() {
  const pool = globalDb.worldSignalPool;
  globalDb.worldSignalPool = undefined;
  await pool?.end();
}
