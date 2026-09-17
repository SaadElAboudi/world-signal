import "./env";
import { ingest, providers } from "../src/server/ingestion";
import { computeSignals } from "../src/server/compute";
import { getPool, closePool } from "../src/database/client";
import { getConfig } from "../src/server/config";
import { log, errorCode } from "../src/server/log";
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
async function main() {
  let lastComputed = 0;
  while (!stopping) {
    try {
      const config = getConfig();
      for (const provider of providers) {
        const last = await getPool().query(
          "SELECT max(started_at) AS attempt,max(finished_at) FILTER(WHERE history AND status='success') AS history FROM provider_runs WHERE provider=$1",
          [provider.id],
        );
        const interval =
          (provider.id === "usgs"
            ? config.usgsIntervalMinutes
            : config.firmsIntervalMinutes) * 60000;
        if (
          !last.rows[0].attempt ||
          Date.now() - last.rows[0].attempt.getTime() >= interval
        )
          await ingest(
            provider,
            !last.rows[0].history ||
              Date.now() - last.rows[0].history.getTime() > 86400000,
          );
      }
      if (Date.now() - lastComputed >= 300000) {
        await computeSignals();
        lastComputed = Date.now();
      }
    } catch (error) {
      log("worker.tick.failed", { code: errorCode(error) });
    }
    for (let i = 0; i < 60 && !stopping; i++)
      await new Promise((r) => setTimeout(r, 1000));
  }
  await closePool();
}
main().catch(() => {
  process.exitCode = 1;
});
