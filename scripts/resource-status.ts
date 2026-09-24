import "./env";
import { closePool } from "../src/database/client";
import {
  getApiUsageSummary,
  getStorageBudgetState,
} from "../src/database/resource-governor";

async function main() {
  const storage = await getStorageBudgetState();
  const api = await getApiUsageSummary();
  console.log(
    JSON.stringify(
      {
        storage: {
          bytes: storage.bytes,
          megabytes: Number((storage.bytes / 1024 / 1024).toFixed(1)),
          quotaMegabytes: Number((storage.quotaBytes / 1024 / 1024).toFixed(1)),
          usagePercent: Number((storage.ratio * 100).toFixed(1)),
          pressure: storage.pressure,
        },
        api,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("Resource status failed", error instanceof Error ? error.message : "unknown_error");
    process.exitCode = 1;
  })
  .finally(closePool);
