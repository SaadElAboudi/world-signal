import "../scripts/env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../scripts/migrate";
import { closePool, getPool } from "../src/database/client";
import {
  getTemperatureReference,
  saveTemperatureReference,
} from "../src/database/climate-reference";
import {
  getWorldEvent,
  resolveMissingProviderEvents,
  upsertWorldEvents,
} from "../src/database/world-events";
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
  await getPool().query(
    "TRUNCATE climate_references, world_event_history, world_events RESTART IDENTITY",
  );
});

after(async () => {
  await closePool();
});

test("unchanged refreshes do not create event history", async () => {
  const first = await upsertWorldEvents(
    [event],
    new Date("2026-09-22T10:01:00Z"),
  );
  assert.deepEqual(first, { inserted: 1, updated: 0, unchanged: 0 });
  const refreshed: WorldEvent = {
    ...event,
    properties: { collectedAt: "2026-09-22T10:16:00.000Z" },
  };
  const second = await upsertWorldEvents(
    [refreshed],
    new Date("2026-09-22T10:16:00Z"),
  );
  assert.deepEqual(second, { inserted: 0, updated: 0, unchanged: 1 });
  const count = await getPool().query(
    "SELECT count(*) FROM world_event_history",
  );
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
  const result = await upsertWorldEvents(
    [resolved],
    new Date("2026-09-22T11:01:00Z"),
  );
  assert.deepEqual(result, { inserted: 0, updated: 1, unchanged: 0 });
  const stored = await getWorldEvent(event.id);
  assert.equal(stored?.status, "resolved");
  assert.equal(stored?.severity, "elevated");
  const history = await getPool().query(
    "SELECT payload FROM world_event_history WHERE event_id=$1",
    [event.id],
  );
  assert.equal(history.rowCount, 1);
  assert.equal(history.rows[0].payload.status, "active");
});

test("provider events absent from the next authoritative refresh resolve once", async () => {
  const weather: WorldEvent = {
    ...event,
    id: "open-meteo:cell:heat:2026-09-22",
    category: "climate",
    type: "temperature_extreme",
    title: "Extreme heat forecast",
    severity: "significant",
    confidence: 0.6,
    source: {
      provider: "open-meteo",
      name: "Open-Meteo",
      url: "https://open-meteo.com/",
      upstreamId: "cell:heat:2026-09-22",
    },
    properties: { forecast: true },
  };
  await upsertWorldEvents([weather], new Date("2026-09-22T12:00:00Z"));
  const resolved = await resolveMissingProviderEvents(
    "open-meteo",
    [],
    new Date("2026-09-22T12:15:00Z"),
  );
  assert.equal(resolved, 1);
  const stored = await getWorldEvent(weather.id);
  assert.equal(stored?.status, "resolved");
  assert.equal(stored?.endedAt, "2026-09-22T12:15:00.000Z");
  assert.equal(stored?.properties.resolvedBecauseMissingFromProvider, true);

  const second = await resolveMissingProviderEvents(
    "open-meteo",
    [],
    new Date("2026-09-22T12:30:00Z"),
  );
  assert.equal(second, 0);
  const history = await getPool().query(
    "SELECT count(*) FROM world_event_history WHERE event_id=$1",
    [weather.id],
  );
  assert.equal(Number(history.rows[0].count), 1);
});

test("climate reference cache stores compact statistics only", async () => {
  await saveTemperatureReference({
    cellId: "8001fffffffffff",
    kind: "heat",
    monthDay: "09-22",
    meanC: 31.4,
    stddevC: 2.8,
    p10C: 27.9,
    p90C: 35.2,
    sampleCount: 450,
    referenceStart: "1991-01-01",
    referenceEnd: "2020-12-31",
  });
  const stored = await getTemperatureReference(
    "8001fffffffffff",
    "heat",
    "09-22",
  );
  assert(stored);
  assert.equal(stored.meanC, 31.4);
  assert.equal(stored.sampleCount, 450);
  const columns = await getPool().query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='climate_references'",
  );
  const names = columns.rows.map((row) => row.column_name);
  assert.equal(names.includes("payload"), false);
  assert.equal(names.includes("raw_data"), false);
});
