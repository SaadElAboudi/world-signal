import test from "node:test";
import assert from "node:assert/strict";
import { GdeltContextProvider, buildGdeltQuery } from "../src/context/providers/gdelt";
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

test("builds a location and signal-type query", () => {
  const query = buildGdeltQuery(signal);
  assert.match(query, /Paris/);
  assert.match(query, /France/);
  assert.match(query, /earthquake/);
  assert.match(query, /seismic/);
});

test("normalizes GDELT articles and bounds the request window", async () => {
  let requested: URL | undefined;
  const provider = new GdeltContextProvider({
    now: () => new Date("2026-09-22T12:00:00.000Z"),
    fetchImpl: async (input) => {
      requested = new URL(String(input));
      return new Response(JSON.stringify({
        articles: [{
          url: "https://news.example/report",
          title: "Paris earthquake response update",
          seendate: "20260922T101500Z",
          domain: "news.example",
          sourcecountry: "France",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const evidence = await provider.searchContext(signal);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.source.name, "news.example");
  assert.equal(evidence[0]?.publishedAt, "2026-09-22T10:15:00.000Z");
  assert.match(evidence[0]?.text ?? "", /Paris earthquake/);
  assert.equal(requested?.searchParams.get("mode"), "artlist");
  assert.equal(requested?.searchParams.get("format"), "json");
  assert.ok(requested?.searchParams.get("startdatetime"));
  assert.ok(requested?.searchParams.get("enddatetime"));
});

test("rejects malformed articles without failing the provider", async () => {
  const provider = new GdeltContextProvider({
    now: () => new Date("2026-09-22T12:00:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({
      articles: [
        { url: "not-a-url", title: "bad", seendate: "20260922T101500Z" },
        { url: "https://valid.example/story", title: "Valid", seendate: "invalid" },
      ],
    }), { status: 200 }),
  });
  assert.deepEqual(await provider.searchContext(signal), []);
});
