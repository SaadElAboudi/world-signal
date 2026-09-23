import { historicalInputs } from "../src/server/correlations";
import "./env";
import { readFile } from "node:fs/promises";
import { correlate } from "../src/correlations/engine";
import {
  CORRELATION_WINDOWS,
  type CorrelationInput,
  type CorrelationWindow,
} from "../src/correlations/types";
import { closePool } from "../src/database/client";
const args = process.argv.slice(2);
function argument(name: string) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith("--"))
    throw new Error(`Missing ${name} value`);
  return args[i + 1];
}
async function main() {
  const asOf = new Date(argument("--as-of") ?? Date.now()).toISOString();
  const windowHours = Number(argument("--window") ?? 6) as CorrelationWindow;
  if (!CORRELATION_WINDOWS.includes(windowHours))
    throw new Error("Window must be 1, 6 or 24 hours");
  const input = argument("--input");
  let signals: CorrelationInput[];
  if (input) {
    signals = JSON.parse(await readFile(input, "utf8"));
    if (!Array.isArray(signals))
      throw new Error(
        "Input must be an array of versioned CorrelationInput records",
      );
  } else {
    signals = await historicalInputs(new Date(asOf), windowHours);
  }
  const output = correlate(signals, {
    asOf,
    windowHours,
    debug: args.includes("--debug"),
  });
  console.log(
    JSON.stringify(
      {
        asOf,
        inputCount: signals.length,
        inputMode: input ? "captured-versions" : "immutable-stored-versions",
        historicalCompleteness: input
          ? "depends-on-supplied-capture"
          : "versions-recorded-since-phase-3-activation",
        ...output,
      },
      null,
      2,
    ),
  );
}
main()
  .catch(() => {
    console.error(
      "Correlation computation failed. Check arguments, input schema and database access. No data was changed.",
    );
    process.exitCode = 1;
  })
  .finally(closePool);
