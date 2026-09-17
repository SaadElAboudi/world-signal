import "./env";
import { computeSignals } from "../src/server/compute";
import { closePool } from "../src/database/client";
computeSignals()
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(closePool);
