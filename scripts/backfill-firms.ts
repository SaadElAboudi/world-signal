import "./env";
import { getConfig } from "../src/server/config";
import { FirmsProvider } from "../src/providers/nasa-firms";
import { ingest } from "../src/server/ingestion";
import { computeSignals } from "../src/server/compute";
import { closePool } from "../src/database/client";
async function main() {
  const config = getConfig();
  if (config.firmsTransport !== "api" || !config.firmsKey)
    throw new Error(
      "Configure FIRMS_TRANSPORT=api and NASA_FIRMS_API_KEY to backfill 31 days.",
    );
  const provider = new FirmsProvider();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let ago = 31; ago > 0; ago -= 10) {
    const startDate = new Date(today.getTime() - ago * 86400000)
      .toISOString()
      .slice(0, 10);
    const result = await ingest(provider, true, new Date(), {
      startDate,
      days: Math.min(10, ago),
    });
    if (result.status !== "success")
      throw new Error("Historical ingestion failed; inspect provider status.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await ingest(provider, false);
  await computeSignals();
}
main()
  .catch((error) => {
    console.error(
      error.message.startsWith("Configure")
        ? error.message
        : "Backfill could not finish; inspect sanitized provider health.",
    );
    process.exitCode = 1;
  })
  .finally(closePool);
