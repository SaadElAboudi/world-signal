import "./env";
import { ingest, providers } from "../src/server/ingestion";
import { computeSignals } from "../src/server/compute";
import { closePool } from "../src/database/client";
async function main() {
  const id = process.argv[2] ?? "all";
  const selected = providers.filter((p) => id === "all" || p.id === id);
  if (!selected.length) throw new Error("Unknown provider");
  for (const provider of selected) {
    const result = await ingest(provider, process.argv.includes("--history"));
    if (result.status === "failed") process.exitCode = 1;
  }
  await computeSignals();
}
main()
  .catch(() => {
    console.error(
      "Ingestion could not finish; inspect sanitized provider health.",
    );
    process.exitCode = 1;
  })
  .finally(closePool);
