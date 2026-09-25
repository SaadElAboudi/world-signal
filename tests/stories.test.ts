import test from "node:test";
import assert from "node:assert/strict";
import { storyFromCorrelation } from "../src/stories/engine";
import type { CorrelatedEvent } from "../src/correlations/types";
import type { Investigation } from "../src/context/investigation";

const correlation: CorrelatedEvent = {
  id: "correlation:taiwan:1", geographicScope: { kind: "country", country: "Taiwan", latitude: 23.7, longitude: 121 },
  startedAt: "2026-09-25T10:00:00.000Z", updatedAt: "2026-09-25T10:10:00.000Z", windowEnd: "2026-09-25T10:10:00.000Z", windowHours: 1,
  signalIds: ["internet:tw", "aviation:tw"], signalTypes: ["internet", "aviation"], providerIds: ["ioda", "adsblol"],
  correlationStrength: 0.8, confidence: 0.75, severity: "significant", status: "active", provenance: "observed", methodology: "fixture", relationship: "fixture",
};

const investigation = (overrides: Partial<Investigation>): Investigation => ({
  schemaVersion: 1, id: "investigation:fixture", eventId: correlation.id, createdAt: correlation.updatedAt,
  window: { start: correlation.startedAt, end: correlation.windowEnd }, location: { country: "Taiwan", region: null, latitude: 23.7, longitude: 121 },
  status: "no_explanation_found_yet", retrievalStatus: "complete", assessment: "none", providers: [], evidence: [],
  explanationConfidence: { score: 0, level: "none", rationale: "fixture" }, timeline: [], unknowns: [], ...overrides,
});

test("a correlation creates a detected story until context retrieval has run", () => {
  const story = storyFromCorrelation(correlation, null, new Date("2026-09-25T10:11:00.000Z"));
  assert.equal(story.status, "detected");
  assert.equal(story.explanationStatus, "pending");
  assert.match(story.title, /Taiwan/);
});

test("a completed context search with no evidence stays explicitly unexplained", () => {
  const story = storyFromCorrelation(correlation, investigation({}), new Date());
  assert.equal(story.status, "unexplained");
  assert.equal(story.explanationStatus, "unexplained");
});

test("failed context retrieval never becomes an unexplained claim", () => {
  const story = storyFromCorrelation(correlation, investigation({ status: "context_unavailable", retrievalStatus: "unavailable" }), new Date());
  assert.equal(story.status, "developing");
  assert.equal(story.explanationStatus, "unavailable");
});

test("official or independently corroborated context can corroborate a story without asserting causality", () => {
  const story = storyFromCorrelation(correlation, investigation({ status: "context_found", assessment: "official_report_found" }), new Date());
  assert.equal(story.status, "corroborated");
  assert.equal(story.explanationStatus, "corroborated");
});
