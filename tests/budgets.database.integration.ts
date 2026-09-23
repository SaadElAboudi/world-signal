import "../scripts/env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../scripts/migrate";
import { closePool, getPool } from "../src/database/client";
import { reserveApiCalls, storageBudget } from "../src/server/budgets";

const liveUrl = process.env.DATABASE_URL;
let testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl && liveUrl) {
  const url = new URL(liveUrl);
  if (["127.0.0.1", "localhost"].includes(url.hostname)) {
    url.pathname = "/world_signal_test";
    testUrl = url.toString();
  }
}
if (!testUrl || !new URL(testUrl).pathname.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must name a dedicated database ending in _test");
}
process.env.DATABASE_URL = testUrl;

before(async () => {
  await migrate();
  await getPool().query("TRUNCATE api_usage_daily, storage_budget_snapshots");
});

after(async () => {
  await closePool();
});

test("API reservations never cross their daily budget", async () => {
  const now = new Date("2026-09-23T08:00:00Z");
  const first = await reserveApiCalls("test-provider", 2, 3, now);
  assert.deepEqual(first, { allowed: true, used: 2, budget: 3 });
  const blocked = await reserveApiCalls("test-provider", 2, 3, now);
  assert.deepEqual(blocked, { allowed: false, used: 2, budget: 3 });
  const final = await reserveApiCalls("test-provider", 1, 3, now);
  assert.deepEqual(final, { allowed: true, used: 3, budget: 3 });
  const stored = await getPool().query(
    "SELECT request_count FROM api_usage_daily WHERE provider='test-provider'",
  );
  assert.equal(Number(stored.rows[0].request_count), 3);
});

test("storage budget records the current database footprint", async () => {
  const now = new Date("2026-09-23T09:00:00Z");
  const result = await storageBudget(now);
  assert(result.bytes > 0);
  assert(result.softLimitBytes < result.hardLimitBytes);
  assert(["normal", "soft_limit", "hard_limit"].includes(result.state));
  const stored = await getPool().query(
    "SELECT database_bytes,state FROM storage_budget_snapshots WHERE captured_at=$1",
    [now],
  );
  assert.equal(stored.rowCount, 1);
  assert.equal(Number(stored.rows[0].database_bytes), result.bytes);
  assert.equal(stored.rows[0].state, result.state);
});
