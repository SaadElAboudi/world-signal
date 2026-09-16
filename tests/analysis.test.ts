import test from "node:test";
import assert from "node:assert/strict";
import { classify, deviation, filterSignals } from "../src/core/analysis";
import { demoSnapshot } from "../src/providers/demo";
import { LAYERS } from "../src/core/types";
test("ratio and percentage use real arithmetic over reference samples", () => {
  assert.equal(deviation(472, Array(30).fill(102), "ratio"), 472 / 102);
  assert.equal(deviation(62, Array(30).fill(100), "percentage"), -38);
});
test("z-score uses population standard deviation, excludes no samples silently", () => {
  assert.equal(deviation(3, [0, 2, 0, 2, 0, 2, 0, 2], "zscore"), 2);
});
test("insufficient or degenerate history is unknown, never a fabricated anomaly", () => {
  assert.equal(deviation(2, [], "ratio"), null);
  assert.equal(deviation(2, Array(30).fill(0), "ratio"), null);
  assert.equal(deviation(2, Array(30).fill(1), "zscore"), null);
  assert.equal(deviation(NaN, Array(30).fill(1), "percentage"), null);
  assert.equal(classify(null, "internet"), null);
});
test("threshold boundaries and directional interpretation", () => {
  assert.equal(classify(-38, "internet"), "significant");
  assert.equal(classify(-25, "aviation"), "elevated");
  assert.equal(classify(9, "internet"), null);
  assert.equal(classify(3, "earthquake"), "significant");
  assert.equal(classify(1.5, "wildfire"), "notable");
  assert.equal(classify(-4, "earthquake"), null);
});
test("time filters exclude future observations during replay", () => {
  const options = {
    types: LAYERS.map((l) => l.id),
    hours: 1,
    asOf: demoSnapshot.asOf,
  };
  assert.equal(filterSignals(demoSnapshot.signals, options).length, 3);
  const past = new Date(
    Date.parse(demoSnapshot.asOf) - 24 * 3600000,
  ).toISOString();
  const result = filterSignals(demoSnapshot.signals, {
    ...options,
    hours: 24,
    asOf: past,
  });
  assert(result.every((s) => Date.parse(s.timestamp) <= Date.parse(past)));
});
test("combined layer, place and severity filters are consistent", () => {
  const result = filterSignals(demoSnapshot.signals, {
    types: ["internet"],
    hours: 24,
    asOf: demoSnapshot.asOf,
    query: "iran",
    significantOnly: true,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].country, "Iran");
  assert.equal(
    filterSignals(demoSnapshot.signals, {
      types: [],
      hours: 720,
      asOf: demoSnapshot.asOf,
    }).length,
    0,
  );
});
test("demo provenance, references and baseline chronology are explicit", () => {
  assert.equal(demoSnapshot.mode, "demo");
  for (const signal of demoSnapshot.signals) {
    assert.equal(signal.provenance, "synthetic");
    assert.equal(signal.baseline.length, 30);
    assert(
      signal.baseline.every(
        (p) => Date.parse(p.timestamp) < Date.parse(signal.timestamp),
      ),
    );
    assert.equal(
      signal.deviation,
      deviation(
        signal.observedValue,
        signal.baseline.map((p) => p.value),
        signal.deviationType,
      ),
    );
    assert.equal(signal.severity, classify(signal.deviation, signal.type));
  }
});
