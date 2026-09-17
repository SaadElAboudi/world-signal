import "./env";
import { readFile } from "node:fs/promises";
import { correlate } from "../src/correlations/engine";
import { scopeForSignal } from "../src/correlations/geography";
import {
  CORRELATION_WINDOWS,
  type CorrelationInput,
  type CorrelationWindow,
} from "../src/correlations/types";
import { getPool, closePool } from "../src/database/client";
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
    // Use the exact stored version and its record time. Never reconstruct an old
    // state using newer evidence. Full historical replay requires captured input
    // versions supplied with --input; overwritten versions cannot be invented.
    const result = await getPool().query(
      "SELECT provider,payload,updated_at,resolved_at FROM signals WHERE updated_at <= $1 AND observed_at >= $1::timestamptz-($2*interval '1 hour') AND started_at <= $1 ORDER BY started_at,id",
      [asOf, windowHours],
    );
    signals = result.rows.map((row) => ({
      signal: row.payload,
      providerId: row.provider,
      scope: scopeForSignal(row.payload),
      recordedAt: row.updated_at.toISOString(),
      ...(row.resolved_at ? { endedAt: row.resolved_at.toISOString() } : {}),
    }));
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
        inputMode: input ? "captured-versions" : "latest-stored-versions",
        historicalCompleteness: input
          ? "depends-on-supplied-capture"
          : "not-a-complete-point-in-time-archive",
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
