import "../scripts/env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../scripts/migrate";
import { closePool, getPool } from "../src/database/client";
import {
  getStorageBudgetState,
  reserveApiBudget,
} from "../src/database/resource-governor";

const liveUrl = process.env.DATABASE_URL;
let testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl && liveUrl) {
  const url = new URL(liveUrl);
  if (["127.0.0.1", "localhost"].includes(url.hostname)) {
    url.pathname = "/world_signal_test";
    testUrl = url.toString();
  }
}
if (!testUrl || !new URL(testUrl).pathname.endsWith("_test"))
  throw new Error("TEST_DATABASE_URL must name a dedicated database ending in _test");
process.env.DATABASE_URL = testUrl;

before(async () => {
  await migrate();
  await getPool().query("TRUNCATE api_usage_daily");
});

after(async () => {
  await closePool();
});

test("API budget reservation hard-stops before exceeding configured limits", async () => {
  const now = new Date("2026-09-23T05:00:00Z");
  const first = await reserveApiBudget("test-provider", 2, { daily: 3, monthly: 3 }, now);
  assert.equal(first.allowed, true);
  const second = await reserveApiBudget("test-provider", 2, { daily: 3, monthly: 3 }, now);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, "daily_limit");
  const stored = await getPool().query(
    "SELECT calls FROM api_usage_daily WHERE provider='test-provider' AND usage_date='2026-09-23'",
  );
  assert.equal(Number(stored.rows[0].calls), 2);
});

test("storage governor reaches critical pressure before a configured hard quota", async () => {
  const previous = process.env.DATABASE_STORAGE_QUOTA_BYTES;
  process.env.DATABASE_STORAGE_QUOTA_BYTES = "1";
  try {
    const storage = await getStorageBudgetState();
    assert.equal(storage.pressure, "critical");
    assert(storage.bytes > 1);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_STORAGE_QUOTA_BYTES;
    else process.env.DATABASE_STORAGE_QUOTA_BYTES = previous;
  }
});
