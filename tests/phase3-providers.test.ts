import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIodaSeries } from "../src/providers/ioda/normalize";
import { normalizeOpenSkySnapshot } from "../src/providers/opensky/normalize";
import { matchedActivityBaseline } from "../src/signals/matched-baseline";
const now = "2026-09-17T12:00:00.000Z",
  seconds = Date.parse(now) / 1000;
const country = { code: "IR", name: "Iran", latitude: 32, longitude: 54 };
const series = {
  entityType: "country",
  entityCode: "IR",
  datasource: "ping-slash24",
  from: seconds - 7200,
  until: seconds,
  step: 3600,
  nativeStep: 600,
  values: [100, null],
};
test("IODA preserves metric identity, null gaps and legitimate zero measurements", () => {
  const batch = normalizeIodaSeries(series, country, now);
  assert.equal(batch.observations.length, 1);
  assert.equal(
    batch.observations[0].properties.metric,
    "probing_responsive_slash24_blocks",
  );
  assert.equal(batch.observations[0].properties.missingSamples, 1);
  assert.equal(batch.sourceAsOf, batch.observations[0].timestamp);
  const bgp = normalizeIodaSeries(
    { ...series, datasource: "bgp", values: [100, 0] },
    country,
    now,
  );
  assert.equal(bgp.observations[1].value, 0);
  assert.notEqual(bgp.observations[0].id, batch.observations[0].id);
  assert.throws(() =>
    normalizeIodaSeries({ ...series, datasource: "gtr" }, country, now),
  );
  assert.throws(() =>
    normalizeIodaSeries(series, { ...country, code: "BR" }, now),
  );
  assert.throws(() =>
    normalizeIodaSeries({ ...series, values: [null, null] }, country, now),
  );
});
function state(
  id: string,
  latitude = 48,
  longitude = 2,
  age = 1,
  ground = false,
) {
  return [
    id,
    "SYNTHETIC",
    "Ignored registration country",
    seconds - age,
    seconds - age,
    longitude,
    latitude,
    5000,
    ground,
  ];
}
test("aviation counts unique fresh airborne aircraft, discards identifiers and does not invent zero cells", () => {
  const states = [
    state("abc123"),
    state("abc123"),
    state("def456"),
    state("111111", 48, 2, 30),
    state("222222", 48, 2, 1, true),
  ];
  const result = normalizeOpenSkySnapshot({ time: seconds, states }, now);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].value, 2);
  assert.equal(result.observations[0].quality, 0.5);
  assert.equal(
    result.observations[0].properties.metric,
    "observed_airborne_aircraft_snapshot",
  );
  assert(!JSON.stringify(result).includes("abc123"));
  assert(!JSON.stringify(result).includes("SYNTHETIC"));
  assert.throws(() =>
    normalizeOpenSkySnapshot({ time: seconds, states: [] }, now),
  );
  assert.throws(() =>
    normalizeOpenSkySnapshot({ time: seconds - 3600, states }, now),
  );
});
test("matched baseline compares UTC hour/day kind and distinct historical days only", () => {
  const current = normalizeOpenSkySnapshot(
    { time: seconds, states: [state("abc123")] },
    now,
  ).observations[0];
  current.value = 20;
  const history = Array.from({ length: 34 }, (_, i) => ({
    ...current,
    id: `history-${i}`,
    timestamp: new Date(Date.parse(now) - (i + 1) * 86400000).toISOString(),
    value: 40,
  }));
  const result = matchedActivityBaseline(current, [...history, ...history], {
    now: new Date(now),
    match: "hour-and-day-kind",
  });
  assert.equal(result.available, true);
  assert.equal(result.deviation, -50);
  assert.equal(result.confidence, 0.5);
  assert.equal(result.sampleCount, 24);
  const weekday = matchedActivityBaseline(current, history, {
    now: new Date(now),
    match: "hour-and-weekday",
  });
  assert.equal(weekday.sampleCount, 4);
  assert.equal(weekday.expected, 40);
});
test("history gaps, different metrics, stale snapshots and missing aircraft coverage never become confident anomalies", () => {
  const current = normalizeOpenSkySnapshot(
    { time: seconds, states: [state("abc123")] },
    now,
  ).observations[0];
  const history = Array.from({ length: 30 }, (_, i) => ({
    ...current,
    timestamp: new Date(Date.parse(now) - (i + 1) * 86400000).toISOString(),
    value: 40,
    properties: { ...current.properties, metric: "different" },
  }));
  assert.equal(
    matchedActivityBaseline(current, history, {
      now: new Date(now),
      match: "hour-and-day-kind",
    }).available,
    false,
  );
  assert.equal(
    matchedActivityBaseline(current, [], {
      now: new Date(Date.parse(now) + 7200000),
      match: "hour-and-weekday",
    }).reason,
    "stale_or_future_observation",
  );
});
