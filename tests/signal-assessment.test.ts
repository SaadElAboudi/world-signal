import test from "node:test";
import assert from "node:assert/strict";
import type { WorldSignal } from "../src/core/types";
import { assessSignal } from "../src/signals/assessment";

const now = new Date("2026-09-25T12:00:00.000Z");
function signal(overrides: Partial<WorldSignal> = {}): WorldSignal {
  return {
    id: "fixture", type: "internet", title: "Fixture", country: "France", region: "Fixture",
    latitude: 48, longitude: 2, timestamp: now.toISOString(), startedAt: now.toISOString(),
    observedValue: 50, expectedValue: 100, unit: "units", deviation: -50, deviationType: "percentage",
    severity: "elevated", source: { name: "Fixture", url: "https://example.test" }, provenance: "observed",
    description: "Fixture", methodology: "Fixture", limitation: "Fixture", confidence: 0.8, baseline: [], context: "", status: "active",
    ...overrides,
  };
}

test("activity anomalies wait for documented persistence before Story eligibility", () => {
  const fresh = assessSignal(signal(), now);
  assert.equal(fresh.assessment?.storyEligible, false);
  const persistent = assessSignal(signal(), new Date(now.getTime() + 30 * 60_000));
  assert.equal(persistent.assessment?.storyEligible, true);
  assert.ok(persistent.assessment!.score > fresh.assessment!.score);
});

test("threshold-selected earthquakes remain eligible without inventing a baseline", () => {
  const earthquake = assessSignal(signal({ type: "earthquake", kind: "earthquake-event", deviation: null, confidence: 0.85, severity: "significant" }), now);
  assert.equal(earthquake.assessment?.storyEligible, true);
  assert.equal(earthquake.assessment?.persistenceMinutes, 0);
});
