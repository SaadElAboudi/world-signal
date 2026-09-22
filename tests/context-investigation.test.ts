import test from "node:test";
import assert from "node:assert/strict";
import { buildInvestigation } from "../src/context/investigation";
import type { ContextProvider } from "../src/context/evidence";
import type { WorldSignal } from "../src/core/types";

const signal: WorldSignal = {
  id: "signal-1", type: "earthquake", title: "Test", severity: "significant", timestamp: "2026-09-22T10:00:00.000Z", startedAt: "2026-09-22T10:00:00.000Z", observedValue: 8, expectedValue: 2, unit: "events", deviation: 6, deviationType: "absolute", baseline: [], confidence: 0.9, latitude: 48.85, longitude: 2.35, country: "France", region: "Paris", source: { name: "USGS", url: "https://example.com/usgs" }, limitation: "test", provenance: "observed", methodology: "test", description: "test", context: "",
};

test("returns explicit no-explanation state when a successful search returns nothing", async () => {
  const provider: ContextProvider = { id: "empty", async searchContext() { return []; } };
  const result = await buildInvestigation(signal, { providers: [provider], signals: [signal], now: new Date("2026-09-22T10:30:00.000Z") });
  assert.equal(result.status, "no_explanation_found_yet");
  assert.equal(result.retrievalStatus, "complete");
  assert.equal(result.providers[0]?.status, "ok");
  assert.equal(result.evidence.length, 0);
  assert.equal(result.timeline[0]?.kind, "signal");
});

test("ranks timely local official evidence above weaker evidence and deduplicates urls", async () => {
  const provider: ContextProvider = { id: "fixture", async searchContext() { return [
    { id: "official", source: { name: "Paris official authority", url: "https://example.com/official" }, publishedAt: "2026-09-22T10:08:00.000Z", retrievedAt: "2026-09-22T10:20:00.000Z", text: "Paris France local authorities issue an operational notice." },
    { id: "weak", source: { name: "Unknown blog", url: "https://example.com/blog" }, publishedAt: "2026-09-22T21:00:00.000Z", retrievedAt: "2026-09-22T21:05:00.000Z", text: "Unrelated discussion with no location match." },
    { id: "official-copy", source: { name: "Paris official authority", url: "https://example.com/official" }, publishedAt: "2026-09-22T10:08:00.000Z", retrievedAt: "2026-09-22T10:21:00.000Z", text: "Paris France local authorities issue an operational notice." },
  ]; } };
  const result = await buildInvestigation(signal, { providers: [provider] });
  assert.equal(result.status, "context_found");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.source.url, "https://example.com/official");
  assert.ok((result.evidence[0]?.score ?? 0) > 0.8);
});

test("provider failure does not erase successful evidence from another provider", async () => {
  const failing: ContextProvider = { id: "failing", async searchContext() { throw new Error("upstream unavailable"); } };
  const healthy: ContextProvider = { id: "healthy", async searchContext() { return [{ id: "report", source: { name: "Reuters", url: "https://example.com/reuters" }, publishedAt: "2026-09-22T10:12:00.000Z", retrievedAt: "2026-09-22T10:13:00.000Z", text: "Paris France reporting relevant to the observed anomaly." }]; } };
  const result = await buildInvestigation(signal, { providers: [failing, healthy] });
  assert.equal(result.status, "context_found");
  assert.equal(result.retrievalStatus, "partial");
  assert.equal(result.evidence.length, 1);
});

test("all provider failures are context unavailable, never no-explanation", async () => {
  const failing: ContextProvider = { id: "failing", async searchContext() { throw new Error("upstream unavailable"); } };
  const result = await buildInvestigation(signal, { providers: [failing] });
  assert.equal(result.status, "context_unavailable");
  assert.equal(result.retrievalStatus, "unavailable");
  assert.equal(result.providers[0]?.status, "error");
});
