import "./env";
import { maintainCompactStorage } from "../src/database/retention";
import { ingest, providers } from "../src/server/ingestion";
import { computeSignals } from "../src/server/compute";
import { refreshRecentInvestigations } from "../src/server/context-refresh";
import {
  refreshAllWorldEvents,
  refreshMarineWorldEvents,
} from "../src/server/world-events";
import { refreshAviation } from "../src/server/aviation";
import { refreshPowerGrid } from "../src/server/power";
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
  let lastMarineRefresh = 0;
  let lastAviationRefresh = 0;
  let lastPowerRefresh = 0;
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

      if (eventRefreshEnabled && Date.now() - lastMarineRefresh >= 60 * 60000) {
        const marine = await refreshMarineWorldEvents();
        log("marine.refresh.completed", {
          status: marine.status,
          received: marine.received,
          inserted: marine.inserted,
          updated: marine.updated,
          unchanged: marine.unchanged,
          resolved: marine.resolved,
        });
        lastMarineRefresh = Date.now();
      }

      if (process.env.ADSB_LOL_ENABLED !== "false" && Date.now() - lastAviationRefresh >= config.adsbLolIntervalMinutes * 60000) {
        const aviation = await refreshAviation();
        log("aviation.refresh.completed", {
          status: aviation.status,
          regions: aviation.regions,
          signals: aviation.signals,
        });
        lastAviationRefresh = Date.now();
      }

      if (process.env.ENTSOE_ENABLED === "true" && Date.now() - lastPowerRefresh >= 60 * 60000) {
        const power = await refreshPowerGrid();
        log("power.refresh.worker", {
          status: power.status,
          regions: power.regions,
          events: power.events,
        });
        lastPowerRefresh = Date.now();
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
        const maintenance = await maintainCompactStorage();
        log("storage.maintenance.completed", {
          pressure: maintenance.storage.pressure,
          usagePercent: Math.round(maintenance.storage.ratio * 100),
          eventHistoryDays: maintenance.profile.eventHistoryDays,
          observationDays: maintenance.profile.observationDays,
          firmsRawRetentionHours: maintenance.profile.firmsRawRetentionHours,
        });
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
      await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await closePool();
}

main().catch(() => {
  process.exitCode = 1;
});
