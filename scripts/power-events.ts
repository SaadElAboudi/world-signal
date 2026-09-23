import "./env";
import { closePool } from "../src/database/client";
import { refreshPowerWorldEvents } from "../src/server/world-events";

async function main() {
  const result = await refreshPowerWorldEvents({ limit: 500 });
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(
      "Power event refresh failed",
      error instanceof Error ? error.message : "unknown_error",
    );
    process.exitCode = 1;
  })
  .finally(closePool);
