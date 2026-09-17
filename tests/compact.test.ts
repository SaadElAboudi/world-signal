import test from "node:test";
import assert from "node:assert/strict";
import { aggregateFireHours } from "../src/database/fire-history";
import type { NormalizedBatch, Observation } from "../src/providers/contract";
function observation(id: string, timestamp: string, quality = 1): Observation {
  return {
    id,
    upstreamId: id,
    provider: "firms",
    type: "wildfire",
    latitude: 0,
    longitude: 0,
    timestamp,
    sourceUpdatedAt: timestamp,
    value: 2,
    cellId: "cell",
    quality,
    sourceUrl: "https://example.test",
    properties: {},
    active: true,
  };
}
test("hourly fire rollups preserve closing boundaries and exclude incomplete hours and low confidence", () => {
  const batch: NormalizedBatch = {
    sourceAsOf: "2026-09-17T04:30:00.000Z",
    coverageStart: "2026-09-17T00:30:00.000Z",
    coverageEnd: "2026-09-17T04:30:00.000Z",
    received: 5,
    rejected: 0,
    observations: [
      observation("partial", "2026-09-17T00:59:00.000Z"),
      observation("boundary", "2026-09-17T02:00:00.000Z"),
      observation("after", "2026-09-17T02:00:00.001Z"),
      observation("low", "2026-09-17T02:30:00.000Z", 0.2),
      observation("partialEnd", "2026-09-17T04:01:00.000Z"),
    ],
  };
  const result = aggregateFireHours(batch);
  assert.deepEqual(result.hours, [
    "2026-09-17T02:00:00.000Z",
    "2026-09-17T03:00:00.000Z",
    "2026-09-17T04:00:00.000Z",
  ]);
  assert.deepEqual(
    result.rows.map((r) => [r.hour_end, r.detections]),
    [
      ["2026-09-17T02:00:00.000Z", 1],
      ["2026-09-17T03:00:00.000Z", 1],
    ],
  );
  assert.equal(result.rows[0].frp_total, 2);
});

test("raw sample caps preserve complete statistical counts and prefer qualified evidence", async () => {
  const { sampleRecentFireObservations } =
    await import("../src/database/fire-history");
  const rows = Array.from({ length: 30 }, (_, i) =>
    observation(
      `sample-${i}`,
      `2026-09-17T02:${String(i + 1).padStart(2, "0")}:00.000Z`,
      i < 10 ? 1 : 0.2,
    ),
  );
  const retained = sampleRecentFireObservations(
    rows,
    "2026-09-17T00:00:00.000Z",
    5,
  );
  assert.equal(retained.length, 5);
  assert.ok(retained.every((o) => o.quality >= 0.5));
  const batch: NormalizedBatch = {
    observations: rows,
    received: 30,
    rejected: 0,
    sourceAsOf: "2026-09-17T04:00:00.000Z",
    coverageStart: "2026-09-17T00:00:00.000Z",
    coverageEnd: "2026-09-17T04:00:00.000Z",
  };
  assert.equal(
    aggregateFireHours(batch).rows.reduce((n, r) => n + r.detections, 0),
    10,
  );
  assert.equal(rows.length, 30);
});
