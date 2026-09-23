import "./env";
import { closePool } from "../src/database/client";
import { getDatabaseBudgetSnapshot } from "../src/database/budget";
import { maintainCompactStorage } from "../src/database/retention";

async function main() {
  const before = await getDatabaseBudgetSnapshot();
  const retention = await maintainCompactStorage();
  const after = await getDatabaseBudgetSnapshot();
  console.log(JSON.stringify({ before, retention, after }, null, 2));
}

main()
  .catch((error) => {
    console.error("Database compaction failed", error instanceof Error ? error.message : "unknown_error");
    process.exitCode = 1;
  })
  .finally(closePool);
