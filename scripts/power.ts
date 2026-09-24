import "./env";
import { closePool } from "../src/database/client";
import { refreshPowerGrid } from "../src/server/power";

async function main() {
  const result = await refreshPowerGrid();
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error("Power refresh failed", error instanceof Error ? error.message : "unknown_error");
    process.exitCode = 1;
  })
  .finally(closePool);
