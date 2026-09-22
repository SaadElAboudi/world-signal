import "./env";
import { closePool } from "../src/database/client";
import { refreshMarineWorldEvents } from "../src/server/world-events";

async function main() {
  const result = await refreshMarineWorldEvents({ limit: 1000 });
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(
      "Marine event refresh failed",
      error instanceof Error ? error.message : "unknown_error",
    );
    process.exitCode = 1;
  })
  .finally(closePool);
