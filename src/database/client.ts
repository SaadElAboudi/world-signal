import { Pool } from "pg";
import { getConfig } from "../server/config";
import { DataError, log } from "../server/log";
const globalDb = globalThis as unknown as { worldSignalPool?: Pool };
export function getPool() {
  if (!globalDb.worldSignalPool) {
    const url = getConfig().databaseUrl;
    if (!url) throw new DataError("database_not_configured");
    globalDb.worldSignalPool = new Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 30000,
      statement_timeout: 120000,
      application_name: "world-signal",
      options: "-c timezone=UTC",
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
