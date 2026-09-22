import "./env";
import { closePool } from "../src/database/client";
import { refreshAviation } from "../src/server/aviation";

async function main() {
  const result = await refreshAviation();
  console.log(JSON.stringify(result));
  if (result.status === "failed" || result.status === "unavailable") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(
      "Aviation refresh failed",
      error instanceof Error ? error.message : "unknown_error",
    );
    process.exitCode = 1;
  })
  .finally(closePool);
