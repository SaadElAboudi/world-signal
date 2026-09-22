import test from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot } from "../src/providers/demo";
import { getSignalInvestigation } from "../src/server/context";
import type { ContextProvider } from "../src/context/evidence";

const demoSignal = demoSnapshot.signals[0];
if (!demoSignal) throw new Error("Expected at least one demo signal");

test("demo investigation is deterministic and never performs live retrieval by default", async () => {
  const result = await getSignalInvestigation(demoSignal.id, "demo");
  assert.ok(result);
  assert.equal(result?.eventId, demoSignal.id);
  assert.equal(result?.status, "no_explanation_found_yet");
  assert.equal(result?.retrievalStatus, "not_attempted");
  assert.deepEqual(result?.evidence, []);
});

test("injected providers can enrich a signal investigation", async () => {
  const provider: ContextProvider = { id: "fixture", async searchContext() { return [{ id: "fixture-report", source: { name: "Official authority", url: "https://example.com/report" }, publishedAt: demoSignal.timestamp, retrievedAt: demoSignal.timestamp, text: `${demoSignal.region} ${demoSignal.country} operational notice` }]; } };
  const result = await getSignalInvestigation(demoSignal.id, "demo", [provider]);
  assert.equal(result?.status, "context_found");
  assert.equal(result?.retrievalStatus, "complete");
  assert.equal(result?.evidence.length, 1);
});

test("unknown demo signal returns null", async () => { assert.equal(await getSignalInvestigation("missing", "demo"), null); });
