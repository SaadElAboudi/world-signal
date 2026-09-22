import test from "node:test";
import assert from "node:assert/strict";
import { buildInvestigation } from "../src/context/investigation";
import type { ContextProvider } from "../src/context/evidence";
import type { WorldSignal } from "../src/core/types";

const signal: WorldSignal = {
  id: "signal-1", type: "earthquake", title: "Test", severity: "significant",
  timestamp: "2026-09-22T10:00:00.000Z", startedAt: "2026-09-22T10:00:00.000Z",
  observedValue: 8, expectedValue: 2, unit: "events", deviation: 6, deviationType: "absolute",
  baseline: [], confidence: 0.9, latitude: 48.85, longitude: 2.35, country: "France", region: "Paris",
  source: { name: "USGS", url: "https://example.com/usgs" }, limitation: "test", provenance: "observed",
  methodology: "test", description: "test", context: "",
};

const official: ContextProvider = {
  id: "official",
  async searchContext() {
    return [{
      id: "gdacs-1",
      source: { name: "GDACS · UN / European Commission", url: "https://gdacs.org/resources.aspx?eventid=1&eventtype=EQ" },
      publishedAt: "2026-09-22T10:08:00.000Z",
      retrievedAt: "2026-09-22T10:10:00.000Z",
      text: "Earthquake alert in Paris France issued by GDACS.",
    }];
  },
};

const media: ContextProvider = {
  id: "media",
  async searchContext() {
    return [{
      id: "news-1",
      source: { name: "Reuters", url: "https://reuters.example/earthquake" },
      publishedAt: "2026-09-22T10:11:00.000Z",
      retrievedAt: "2026-09-22T10:12:00.000Z",
      text: "Reuters reports an earthquake in Paris France.",
    }];
  },
};

test("news-only context is reported but not official", async () => {
  const result = await buildInvestigation(signal, { providers: [media] });
  assert.equal(result.assessment, "reported");
});

test("official evidence is classified separately from general reporting", async () => {
  const result = await buildInvestigation(signal, { providers: [official] });
  assert.equal(result.assessment, "official_report_found");
  assert.match(result.explanationConfidence.rationale, /official reporting/i);
});

test("official plus independent reporting becomes independently corroborated", async () => {
  const result = await buildInvestigation(signal, { providers: [official, media] });
  assert.equal(result.assessment, "independently_corroborated");
  assert.equal(result.evidence.length, 2);
});

test("empty successful retrieval remains assessment none", async () => {
  const empty: ContextProvider = { id: "empty", async searchContext() { return []; } };
  const result = await buildInvestigation(signal, { providers: [empty] });
  assert.equal(result.assessment, "none");
  assert.equal(result.status, "no_explanation_found_yet");
});
