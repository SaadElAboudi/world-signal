import "../scripts/env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../scripts/migrate";
import { closePool, getPool } from "../src/database/client";
import { getWorldEvent, upsertWorldEvents } from "../src/database/world-events";
import type { WorldEvent } from "../src/events/types";

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

const event: WorldEvent = {
  schemaVersion: 1,
  id: "eonet:test-event",
  category: "natural_hazard",
  type: "volcano",
  title: "Test volcano",
  description: null,
  status: "active",
  severity: "notable",
  confidence: 0.8,
  startedAt: "2026-09-22T10:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
  endedAt: null,
  location: { latitude: 37.7, longitude: 15.1, geometryType: "point" },
  magnitude: { value: null, unit: null, description: null },
  source: {
    provider: "eonet",
    name: "NASA EONET",
    url: "https://example.test/eonet/test-event",
    upstreamId: "test-event",
  },
  secondarySources: [],
  properties: { collectedAt: "2026-09-22T10:01:00.000Z" },
};

before(async () => {
  await migrate();
  await getPool().query("TRUNCATE world_event_history, world_events RESTART IDENTITY");
});

after(async () => {
  await closePool();
});

test("unchanged refreshes do not create event history", async () => {
  const first = await upsertWorldEvents([event], new Date("2026-09-22T10:01:00Z"));
  assert.deepEqual(first, { inserted: 1, updated: 0, unchanged: 0 });
  const refreshed: WorldEvent = {
    ...event,
    properties: { collectedAt: "2026-09-22T10:16:00.000Z" },
  };
  const second = await upsertWorldEvents([refreshed], new Date("2026-09-22T10:16:00Z"));
  assert.deepEqual(second, { inserted: 0, updated: 0, unchanged: 1 });
  const count = await getPool().query("SELECT count(*) FROM world_event_history");
  assert.equal(Number(count.rows[0].count), 0);
});

test("semantic event changes archive exactly one previous version", async () => {
  const resolved: WorldEvent = {
    ...event,
    status: "resolved",
    severity: "elevated",
    updatedAt: "2026-09-22T11:00:00.000Z",
    endedAt: "2026-09-22T11:00:00.000Z",
  };
  const result = await upsertWorldEvents([resolved], new Date("2026-09-22T11:01:00Z"));
  assert.deepEqual(result, { inserted: 0, updated: 1, unchanged: 0 });
  const stored = await getWorldEvent(event.id);
  assert.equal(stored?.status, "resolved");
  assert.equal(stored?.severity, "elevated");
  const history = await getPool().query("SELECT payload FROM world_event_history WHERE event_id=$1", [event.id]);
  assert.equal(history.rowCount, 1);
  assert.equal(history.rows[0].payload.status, "active");
});
