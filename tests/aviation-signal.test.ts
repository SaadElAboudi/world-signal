import test from "node:test";
import assert from "node:assert/strict";
import type { Observation } from "../src/providers/contract";
import { aviationDisruption } from "../src/signals/aviation";

const now = new Date("2026-09-22T20:15:00.000Z");

function point(id: string, timestamp: string, value: number): Observation {
  return {
    id,
    upstreamId: id,
    provider: "adsblol",
    type: "aviation",
    latitude: 49,
    longitude: 6,
    timestamp,
    sourceUpdatedAt: timestamp,
    value,
    cellId: "821f97fffffffff",
    quality: 0.55,
    sourceUrl: "https://www.adsb.lol/",
    properties: {
      metric: "observed_airborne_aircraft_snapshot",
      seriesKey: "western-europe",
      region: "Western Europe",
      radiusNm: 250,
      stepSeconds: 900,
      snapshotSeconds: 30,
    },
    active: true,
  };
}

function matchedHistory(value = 40) {
  return Array.from({ length: 14 }, (_, i) => {
    const daysAgo = i + 1;
    const date = new Date(now.getTime() - daysAgo * 86_400_000);
    return point(`history-${i}`, date.toISOString(), value);
  });
}

test("aviation disruption requires enough matched history and a material drop", () => {
  const current = point("current", now.toISOString(), 20);
  assert.equal(aviationDisruption(current, matchedHistory().slice(0, 3), now), null);
  assert.equal(aviationDisruption(point("current-2", now.toISOString(), 30), matchedHistory(), now), null);
  const signal = aviationDisruption(current, matchedHistory(), now);
  assert(signal);
  assert.equal(signal.type, "aviation");
  assert.equal(signal.kind, "aviation-disruption");
  assert.equal(signal.severity, "notable");
  assert.equal(signal.expectedValue, 40);
  assert.equal(signal.deviation, -50);
  assert.equal(signal.confidence, 0.55);
});

test("aviation severity rises only for larger reductions", () => {
  const elevated = aviationDisruption(point("current", now.toISOString(), 15), matchedHistory(), now);
  const significant = aviationDisruption(point("current-2", now.toISOString(), 5), matchedHistory(), now);
  assert.equal(elevated?.severity, "elevated");
  assert.equal(significant?.severity, "significant");
});

test("aviation baseline does not mix neighboring sentinel series", () => {
  const other = matchedHistory().map((entry) => ({
    ...entry,
    id: `other-${entry.id}`,
    properties: { ...entry.properties, seriesKey: "uk-north-sea" },
  }));
  const signal = aviationDisruption(point("current", now.toISOString(), 10), other, now);
  assert.equal(signal, null);
});
