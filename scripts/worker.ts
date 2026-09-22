import "./env";
import { maintainCompactStorage } from "../src/database/retention";
import { ingest, providers } from "../src/server/ingestion";
import { computeSignals } from "../src/server/compute";
import { refreshRecentInvestigations } from "../src/server/context-refresh";
import { refreshAllWorldEvents } from "../src/server/world-events";
import { getPool, closePool } from "../src/database/client";
import { getConfig } from "../src/server/config";
import { log, errorCode } from "../src/server/log";
const once = process.argv.includes("--once");
const eventRefreshEnabled = process.env.WORLD_EVENT_REFRESH_ENABLED !== "false";
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
async function main() {
  let lastComputed = 0;
  let lastContextRefresh = 0;
  let lastEventRefresh = 0;
  let lastMaintenance = 0;
  while (!stopping) {
    let failed = false;
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
          process.argv.includes("--force") ||
          !last.rows[0].attempt ||
          Date.now() - last.rows[0].attempt.getTime() >= interval
        ) {
          const result = await ingest(
            provider,
            !last.rows[0].history ||
              Date.now() - last.rows[0].history.getTime() > 86400000,
          );
          if (result.status === "failed" || result.status === "unavailable")
            failed = true;
        }
      }
      if (Date.now() - lastComputed >= 300000) {
        await computeSignals();
        lastComputed = Date.now();
      }
      if (eventRefreshEnabled && Date.now() - lastEventRefresh >= 15 * 60000) {
        const events = await refreshAllWorldEvents({ days: 14, limit: 1000 });
        log("events.refresh.completed", {
          providers: JSON.stringify(
            events.providers.map((provider) => ({
              provider: provider.provider,
              status: provider.status,
              received: provider.received,
              inserted: provider.inserted,
              updated: provider.updated,
              unchanged: provider.unchanged,
              resolved: provider.resolved,
            })),
          ),
        });
        lastEventRefresh = Date.now();
      }
      if (Date.now() - lastContextRefresh >= 15 * 60000) {
        const contextResult = await refreshRecentInvestigations();
        log("context.refresh.completed", {
          status: contextResult.status,
          attempted: contextResult.attempted,
          refreshed: contextResult.refreshed,
          failed: contextResult.failed,
          prunedHistory: contextResult.prunedHistory,
        });
        lastContextRefresh = Date.now();
      }
      if (Date.now() - lastMaintenance >= 3600000) {
        await maintainCompactStorage();
        lastMaintenance = Date.now();
      }
    } catch (error) {
      log("worker.tick.failed", { code: errorCode(error) });
      failed = true;
    }
    if (once) {
      if (failed) process.exitCode = 1;
      break;
    }
    for (let i = 0; i < 60 && !stopping; i++)
      await new Promise((r) => setTimeout(r, 1000));
  }
  await closePool();
}
main().catch(() => {
  process.exitCode = 1;
});
