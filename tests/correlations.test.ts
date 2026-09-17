import test from "node:test";
import assert from "node:assert/strict";
import { latLngToCell, cellToParent } from "h3-js";
import type { WorldSignal } from "../src/core/types";
import {
  correlate,
  reconcileEvents,
  scoreCandidate,
} from "../src/correlations/engine";
import {
  geographicRelation,
  scopeForSignal,
} from "../src/correlations/geography";
import type { CorrelationInput } from "../src/correlations/types";
import { buildEvidencePackage } from "../src/context/evidence";
const asOf = "2026-09-17T12:00:00.000Z";
function input(
  id: string,
  type: WorldSignal["type"],
  options: Partial<WorldSignal> = {},
): CorrelationInput {
  const signal: WorldSignal = {
    id,
    type,
    title: "Fixture anomaly",
    country: "Iran",
    region: "Fixture",
    latitude: 35.7,
    longitude: 51.4,
    timestamp: "2026-09-17T11:00:00.000Z",
    observedValue: 60,
    expectedValue: 100,
    unit: "fixture",
    deviation: -40,
    deviationType: "percentage",
    severity: "significant",
    source: { name: "Test source", url: "https://example.test/" },
    provenance: "observed",
    description: "Fixture only",
    methodology: "Fixture",
    limitation: "Test only",
    confidence: 0.85,
    baseline: [],
    context: "",
    status: "active",
    ...options,
  };
  return {
    signal,
    providerId: {
      internet: "ioda",
      aviation: "opensky",
      earthquake: "usgs",
      wildfire: "firms",
    }[type],
    recordedAt: signal.timestamp,
    scope: scopeForSignal(signal),
  };
}
test("Iran Internet and aviation in one six-hour window form one event", () => {
  const a = input("internet", "internet"),
    b = input("aviation", "aviation", {
      timestamp: "2026-09-17T10:00:00.000Z",
    });
  const { events } = correlate([a, b], { asOf });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].signalTypes, ["aviation", "internet"]);
  assert.equal(events[0].geographicScope.kind, "country");
  assert.equal(events[0].confidence, 0.85);
  assert.match(events[0].relationship, /not establish.*causality/);
});
test("Iran Internet and Brazil fire do not correlate", () => {
  const a = input("internet", "internet"),
    b = input("fire", "wildfire", {
      country: "Brazil",
      latitude: -10,
      longitude: -50,
    });
  assert.equal(scoreCandidate(a, b).reason, "geographic_mismatch");
  assert.equal(correlate([a, b], { asOf, debug: true }).debug?.comparisons, 0);
});
test("Cloudflare and IODA corroborate only one system", () => {
  const a = input("ioda", "internet"),
    b = input("cloudflare", "internet");
  b.providerId = "cloudflare";
  const result = correlate([a, b], { asOf });
  assert.equal(result.events.length, 0);
  assert.equal(result.confirmations.length, 1);
  assert.equal(result.confirmations[0].confidence, 0.9);
  assert.equal(
    correlate([a, { ...b, providerId: "ioda" }], { asOf }).confirmations.length,
    0,
  );
});
test("duplicate signal versions do not inflate systems or strength", () => {
  const a = input("internet", "internet"),
    b = input("aviation", "aviation");
  assert.deepEqual(
    correlate([a, b, a, b], { asOf }),
    correlate([a, b], { asOf }),
  );
});
test("H3 containment supports multiple resolutions without broad country matching", () => {
  const a = input("quake", "earthquake"),
    b = input("fire", "wildfire");
  const fine = latLngToCell(35.7, 51.4, 3);
  a.scope.cellId = cellToParent(fine, 2);
  b.scope.cellId = fine;
  assert.equal(geographicRelation(a.scope, b.scope)?.score, 0.9);
  b.scope.cellId = latLngToCell(29.6, 52.5, 3);
  assert.equal(geographicRelation(a.scope, b.scope), null);
});
test("time windows, low confidence, thresholds and provenance gate correlation", () => {
  const a = input("internet", "internet"),
    b = input("aviation", "aviation", {
      timestamp: "2026-09-17T08:00:00.000Z",
    });
  assert.equal(scoreCandidate(a, b, 1).reason, "outside_time_window");
  assert.equal(scoreCandidate(a, b, 6, 0.99).reason, "below_threshold");
  b.signal.confidence = 0.2;
  assert.equal(scoreCandidate(a, b).reason, "insufficient_confidence");
  b.signal.confidence = 0.85;
  b.signal.provenance = "synthetic";
  assert.equal(scoreCandidate(a, b).reason, "mixed_provenance");
});
test("three related independent systems merge deterministically into one event", () => {
  const inputs = [
    input("net", "internet"),
    input("air", "aviation"),
    input("quake", "earthquake"),
  ];
  const result = correlate(inputs, { asOf });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].signalTypes.length, 3);
  assert.deepEqual(result, correlate([...inputs].reverse(), { asOf }));
});
test("complete-link grouping rejects transitive geographic inflation", () => {
  const a = input("net", "internet"),
    b = input("air", "aviation"),
    c = input("quake", "earthquake", { latitude: 29.6, longitude: 52.5 });
  const { events } = correlate([a, b, c], { asOf });
  assert.equal(events.length, 1);
  assert.equal(events[0].signalIds.length, 2);
});
test("provider outages and missing members never resolve an event", () => {
  const a = input("net", "internet"),
    b = input("air", "aviation");
  const previous = correlate([a, b], { asOf }).events;
  a.signal.status = "resolved";
  b.signal.status = "resolved";
  assert.equal(
    reconcileEvents(previous, [], [a, b], new Set(["ioda"]), asOf)[0].status,
    "active",
  );
  assert.equal(
    reconcileEvents(previous, [], [a], new Set(["ioda", "opensky"]), asOf)[0]
      .status,
    "active",
  );
  assert.equal(
    reconcileEvents(previous, [], [a, b], new Set(["ioda", "opensky"]), asOf)[0]
      .status,
    "resolved",
  );
});
test("historical recomputation excludes evidence not yet known, then chooses latest known version", () => {
  const a = input("net", "internet"),
    b = input("air", "aviation");
  const future = structuredClone(a);
  future.recordedAt = "2026-09-17T13:00:00.000Z";
  future.signal.confidence = 0.1;
  const result = correlate([a, future, b], { asOf, debug: true });
  assert.equal(result.events.length, 1);
  assert.equal(result.debug?.excluded[0].reason, "not_known_at_as_of");
  future.recordedAt = "2026-09-17T11:30:00.000Z";
  assert.equal(correlate([a, future, b], { asOf }).events.length, 0);
  assert.throws(() => correlate([a, b], { asOf: "invalid" }));
});
test("unassigned countries and unknown providers do not form national matches", () => {
  const a = input("net", "internet", { country: "Offshore / unassigned" }),
    b = input("air", "aviation", { country: "Offshore / unassigned" });
  assert.equal(correlate([a, b], { asOf }).events.length, 0);
  a.scope.country = "Iran";
  b.scope.country = "Iran";
  b.providerId = "unknown";
  assert.equal(correlate([a, b], { asOf }).events.length, 0);
});
test("evidence package keeps separate sources, known timestamps and explicit unknowns", () => {
  const a = input("net", "internet"),
    b = input("air", "aviation", { timestamp: "2026-09-17T10:00:00.000Z" });
  const event = correlate([a, b], { asOf }).events[0];
  const evidence = buildEvidencePackage(event, [a.signal, b.signal]);
  assert.equal(evidence.timeline[0].signalId, "air");
  assert.equal(evidence.signals.length, 2);
  assert.equal(evidence.signals[0].sources.length, 1);
  assert.match(evidence.unknowns[0], /Causality/);
  assert.throws(() => buildEvidencePackage(event, [a.signal]), /Missing/);
  assert.deepEqual(evidence, buildEvidencePackage(event, [b.signal, a.signal]));
});

test("spatial index does not compare unrelated local cells within one country", () => {
  const a = input("air", "aviation"),
    b = input("fire", "wildfire", { latitude: 29.6, longitude: 52.5 });
  assert.equal(correlate([a, b], { asOf, debug: true }).debug?.comparisons, 0);
});
test("a newer ineligible version cannot resurrect its previous eligible version", () => {
  const a = input("net", "internet"),
    b = input("air", "aviation");
  const invalid = structuredClone(a);
  invalid.recordedAt = "2026-09-17T11:30:00.000Z";
  invalid.signal.confidence = NaN;
  assert.equal(correlate([a, b, invalid], { asOf }).events.length, 0);
});
test("expanded events supersede subsets and unhealthy sources cannot resolve a current match", () => {
  const a = input("net", "internet"),
    b = input("air", "aviation"),
    c = input("quake", "earthquake");
  const previous = correlate([a, b], { asOf }).events;
  const expanded = correlate([a, b, c], { asOf }).events;
  assert.equal(
    reconcileEvents(previous, expanded, [a, b, c], new Set(), asOf).length,
    1,
  );
  a.signal.status = "resolved";
  b.signal.status = "resolved";
  const resolved = correlate([a, b], { asOf }).events;
  assert.equal(
    reconcileEvents(previous, resolved, [a, b], new Set(), asOf)[0].status,
    "active",
  );
});
