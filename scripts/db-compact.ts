import "./env";
import { closePool } from "../src/database/client";
import { maintainCompactStorage } from "../src/database/retention";

async function main() {
  const budget = await maintainCompactStorage(new Date());
  console.log(JSON.stringify({ status: "compacted", budget }));
}

main()
  .catch(() => {
    console.error("DATABASE_COMPACTION_FAILED");
    process.exitCode = 1;
  })
  .finally(closePool);
