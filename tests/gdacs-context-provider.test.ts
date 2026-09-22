import test from "node:test";
import assert from "node:assert/strict";
import { GdacsContextProvider } from "../src/context/providers/gdacs";
import type { WorldSignal } from "../src/core/types";

const signal: WorldSignal = {
  id: "eq-1",
  type: "earthquake",
  title: "Earthquake anomaly",
  country: "France",
  region: "Paris",
  latitude: 48.85,
  longitude: 2.35,
  timestamp: "2026-09-22T10:00:00.000Z",
  startedAt: "2026-09-22T10:00:00.000Z",
  observedValue: 8,
  expectedValue: 2,
  unit: "events",
  deviation: 6,
  deviationType: "absolute",
  severity: "significant",
  source: { name: "USGS", url: "https://example.com/usgs" },
  provenance: "observed",
  description: "Test signal",
  methodology: "test",
  limitation: "test only",
  confidence: 0.9,
  baseline: [],
  context: "",
};

test("queries GDACS for supported event types and normalizes official alerts", async () => {
  let requested: URL | undefined;
  const provider = new GdacsContextProvider({
    now: () => new Date("2026-09-22T12:00:00.000Z"),
    fetchImpl: async (input) => {
      requested = new URL(String(input));
      return new Response(JSON.stringify({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {
            eventtype: "EQ",
            eventid: 12345,
            episodeid: 2,
            fromdate: "2026-09-22T10:10:00Z",
            country: "France",
            name: "Earthquake in France",
            alertlevel: "orange",
            description: "GDACS earthquake alert for France",
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const evidence = await provider.searchContext(signal);
  assert.equal(requested?.searchParams.get("eventlist"), "EQ");
  assert.equal(requested?.searchParams.get("alertlevel"), "red;orange;green");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.source.name, "GDACS · UN / European Commission");
  assert.match(evidence[0]?.source.url ?? "", /eventid=12345/);
  assert.match(evidence[0]?.text ?? "", /earthquake/i);
  assert.match(evidence[0]?.text ?? "", /France/);
});

test("returns no GDACS request for unsupported signal systems", async () => {
  let calls = 0;
  const provider = new GdacsContextProvider({
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ features: [] }), { status: 200 });
    },
  });
  const unsupported = { ...signal, id: "internet-1", type: "internet" as const };
  assert.deepEqual(await provider.searchContext(unsupported), []);
  assert.equal(calls, 0);
});

test("malformed GDACS features are ignored instead of poisoning retrieval", async () => {
  const provider = new GdacsContextProvider({
    now: () => new Date("2026-09-22T12:00:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({
      features: [
        { properties: { eventtype: "EQ", fromdate: "2026-09-22T10:10:00Z" } },
        { properties: { eventtype: "EQ", eventid: 2, fromdate: "not-a-date" } },
      ],
    }), { status: 200 }),
  });
  assert.deepEqual(await provider.searchContext(signal), []);
});
