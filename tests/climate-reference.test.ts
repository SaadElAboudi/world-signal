import test from "node:test";
import assert from "node:assert/strict";
import {
  temperatureAnomaly,
  temperatureReferenceFromArchive,
} from "../src/climate/reference";

function archive(centerC: number) {
  const time: string[] = [];
  const max: number[] = [];
  const min: number[] = [];
  for (let year = 1991; year <= 2020; year++) {
    for (let offset = -7; offset <= 7; offset++) {
      const date = new Date(Date.UTC(year, 8, 22 + offset));
      time.push(date.toISOString().slice(0, 10));
      const variation = ((year + offset) % 5) - 2;
      max.push(centerC + variation);
      min.push(centerC - 20 + variation);
    }
  }
  return {
    daily: {
      time,
      temperature_2m_max: max,
      temperature_2m_min: min,
    },
  };
}

test("ERA5 climatology uses the matching seasonal window across 1991-2020", () => {
  const reference = temperatureReferenceFromArchive(
    archive(32),
    new Date("2026-09-22T12:00:00Z"),
    "heat",
  );
  assert.equal(reference.sampleCount, 450);
  assert(reference.meanC > 30 && reference.meanC < 34);
  assert(reference.stddevC > 0);
  assert(reference.p90C >= reference.meanC);
});

test("temperature anomaly preserves signed delta and z-score", () => {
  const anomaly = temperatureAnomaly(44, {
    meanC: 32,
    stddevC: 3,
    p10C: 28,
    p90C: 36,
    sampleCount: 450,
  });
  assert.equal(anomaly.deltaC, 12);
  assert.equal(anomaly.zscore, 4);
});

test("climatology rejects references with too few seasonal samples", () => {
  assert.throws(
    () =>
      temperatureReferenceFromArchive(
        {
          daily: {
            time: Array.from({ length: 20 }, (_, i) => `2000-09-${String(i + 1).padStart(2, "0")}`),
            temperature_2m_max: Array(20).fill(30),
            temperature_2m_min: Array(20).fill(10),
          },
        },
        new Date("2026-09-22T12:00:00Z"),
        "heat",
      ),
    /Insufficient ERA5 climatology samples/,
  );
});
