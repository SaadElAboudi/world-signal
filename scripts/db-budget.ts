import "./env";
import { closePool } from "../src/database/client";
import { getDatabaseBudgetSnapshot } from "../src/database/budget";

async function main() {
  const snapshot = await getDatabaseBudgetSnapshot();
  console.log(JSON.stringify(snapshot, null, 2));
  if (!process.argv.includes("--strict")) return;
  if (snapshot.state === "emergency") process.exitCode = 2;
  else if (snapshot.state === "protect") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Database budget check failed", error instanceof Error ? error.message : "unknown_error");
    process.exitCode = 1;
  })
  .finally(closePool);
