import "../scripts/env";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { migrate } from "../scripts/migrate";
import { getPool, closePool } from "../src/database/client";
import { ingest } from "../src/server/ingestion";
import { computeSignals } from "../src/server/compute";
import { getSnapshot, clearSnapshotCache } from "../src/server/snapshot";
import { UsgsProvider } from "../src/providers/usgs";
import { geographicCell } from "../src/signals/geography";
import type {
  ObservationProvider,
  NormalizedBatch,
  RawBatch,
  Observation,
} from "../src/providers/contract";
import { GET as signalsGet } from "../src/app/api/signals/route";
import { GET as signalGet } from "../src/app/api/signals/[id]/route";
import { DataError } from "../src/server/log";
const liveUrl = process.env.DATABASE_URL;
let testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl && liveUrl) {
  const url = new URL(liveUrl);
  if (["127.0.0.1", "localhost"].includes(url.hostname)) {
    url.pathname = "/world_signal_test";
    testUrl = url.toString();
  }
}
if (!testUrl || !new URL(testUrl).pathname.endsWith("_test"))
  throw new Error(
    "TEST_DATABASE_URL must name a dedicated database ending in _test. Refusing to modify another database.",
  );
process.env.DATABASE_URL = testUrl;
process.env.WORLD_SIGNAL_MODE = "live";
const now = new Date("2026-09-17T02:00:00.000Z");
const raw: RawBatch<unknown> = {
  data: JSON.parse(readFileSync("tests/fixtures/usgs.json", "utf8")),
  fetchedAt: now.toISOString(),
  sourceAsOf: now.toISOString(),
  coverageStart: new Date(now.getTime() - 30 * 86400000).toISOString(),
  coverageEnd: now.toISOString(),
  sourceUrl: "https://example.test/fixture",
};
const baseProvider = new UsgsProvider();
const fixtureProvider: ObservationProvider = {
  id: "usgs",
  name: "Fixture USGS",
  type: "earthquake",
  fetchRawData: async () => structuredClone(raw),
  normalize: (batch) => baseProvider.normalize(batch),
};
before(async () => {
  await migrate();
  await getPool().query(
    "TRUNCATE fire_hourly,fire_hour_coverage,signal_evidence,signals,observations,provider_runs RESTART IDENTITY CASCADE",
  );
});
after(async () => {
  await closePool();
});
test("ingestion is idempotent and source revisions update existing observations", async () => {
  const first = await ingest(fixtureProvider, true, now);
  assert.equal(first.status, "success");
  assert.ok("inserted" in first && first.inserted === 2);
  const second = await ingest(fixtureProvider, true, now);
  assert.ok(
    "inserted" in second && second.inserted === 0 && second.updated === 0,
  );
  const revised = structuredClone(raw) as RawBatch<{
    features: { properties: { mag: number; updated: number } }[];
  }>;
  revised.data.features[0].properties.mag = 6.1;
  revised.data.features[0].properties.updated += 1000;
  const changed = await ingest(
    { ...fixtureProvider, fetchRawData: async () => revised },
    true,
    now,
  );
  assert.ok("updated" in changed && changed.updated === 1);
  assert.equal(
    Number(
      (await getPool().query("SELECT count(*) FROM observations")).rows[0]
        .count,
    ),
    2,
  );
});
test("provider lock prevents duplicate concurrent workers", async () => {
  const client = await getPool().connect();
  await client.query(
    "SELECT pg_advisory_lock(hashtext('world-signal:ingest:usgs'))",
  );
  try {
    assert.equal((await ingest(fixtureProvider, true, now)).status, "skipped");
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext('world-signal:ingest:usgs'))",
    );
    client.release();
  }
});
test("malformed ingestion does not mutate stored observations or create false coverage", async () => {
  const failed = await ingest(
    {
      ...fixtureProvider,
      normalize: (batch) => ({ ...baseProvider.normalize(batch), rejected: 1 }),
    },
    true,
    now,
  );
  assert.equal(failed.status, "failed");
  const rows = await getPool().query(
    "SELECT status,coverage_start FROM provider_runs ORDER BY id DESC LIMIT 1",
  );
  assert.equal(rows.rows[0].status, "failed");
  assert.equal(rows.rows[0].coverage_start, null);
  assert.equal(
    Number(
      (await getPool().query("SELECT count(*) FROM observations")).rows[0]
        .count,
    ),
    2,
  );
});
test("PostgreSQL aggregation and anomaly recomputation produce independently traceable categories", async () => {
  await ingest(fixtureProvider, true, now);
  const end = Math.floor((now.getTime() - 3 * 3600000) / 3600000) * 3600000;
  const observations: Observation[] = [];
  for (let bucket = 0; bucket <= 6; bucket++)
    for (let i = 0; i < (bucket === 0 ? 80 : 10); i++) {
      const id = `fixture-fire-${bucket}-${i}`;
      observations.push({
        id,
        upstreamId: id,
        provider: "firms",
        type: "wildfire",
        latitude: -5.5,
        longitude: -57,
        timestamp: new Date(
          end - bucket * 86400000 - 1000 - i * 1000,
        ).toISOString(),
        sourceUpdatedAt: now.toISOString(),
        value: 2,
        cellId: geographicCell(-5.5, -57, "wildfire"),
        quality: 1,
        sourceUrl: "https://example.test/fixture",
        properties: { confidence: "h" },
        active: true,
      });
    }
  const batch: NormalizedBatch = {
    observations,
    received: observations.length,
    rejected: 0,
    sourceAsOf: now.toISOString(),
    coverageStart: new Date(now.getTime() - 8 * 86400000).toISOString(),
    coverageEnd: now.toISOString(),
  };
  await ingest(
    {
      id: "firms",
      name: "Fixture FIRMS",
      type: "wildfire",
      fetchRawData: async () => ({ ...raw, data: null }),
      normalize: () => batch,
    },
    true,
    now,
  );
  assert.equal((await computeSignals(now)).status, "success");
  const snapshot = await getSnapshot(new URLSearchParams("mode=live"), now);
  assert.equal(snapshot.mode, "live");
  assert.equal(snapshot.status, "partial");
  assert.equal(
    snapshot.providers.find((p) => p.id === "ioda")?.status,
    "unavailable",
  );
  assert.ok(snapshot.signals.some((s) => s.type === "earthquake"));
  const fire = snapshot.signals.find((s) => s.type === "wildfire")!;
  assert.equal(fire.observedValue, 80);
  assert.ok(fire.expectedValue !== null && fire.expectedValue > 0);
  assert.ok(fire.evidence!.observationIds.length <= 20);
  assert.ok(fire.provenance === "observed");
  assert.ok(
    Number(
      (await getPool().query("SELECT count(*) FROM signal_evidence")).rows[0]
        .count,
    ) > 0,
  );
});
test("real API filtering, detail routes and invalid-query errors work against PostgreSQL", async () => {
  const query =
    "mode=live&type=wildfire&since=2026-09-16T00:00:00Z&until=2026-09-17T02:00:00Z&bbox=-60,-10,-50,0";
  const response = await signalsGet(
    new Request(`http://localhost/api/signals?${query}`),
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.signals.length, 1);
  assert.equal(data.signals[0].type, "wildfire");
  const detail = await signalGet(
    new Request("http://localhost/api/signals/x?mode=live"),
    { params: Promise.resolve({ id: data.signals[0].id }) },
  );
  assert.equal(detail.status, 200);
  assert.ok((await detail.json()).evidence);
  assert.equal(
    (
      await signalsGet(
        new Request("http://localhost/api/signals?mode=live&bbox=bad"),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await signalGet(new Request("http://localhost/api/signals/x?mode=live"), {
        params: Promise.resolve({ id: "missing" }),
      })
    ).status,
    404,
  );
});
test("one provider failure does not erase the other provider or insert demo signals", async () => {
  await ingest(
    {
      ...fixtureProvider,
      fetchRawData: async () => {
        throw new DataError("network_or_timeout");
      },
    },
    false,
    now,
  );
  clearSnapshotCache();
  const snapshot = await getSnapshot(new URLSearchParams("mode=live"), now);
  assert.equal(snapshot.status, "partial");
  assert.ok(snapshot.signals.some((s) => s.type === "wildfire"));
  assert.ok(snapshot.signals.every((s) => s.provenance === "observed"));
});
test("database interruption returns unavailable live state while demo remains functional", async () => {
  await closePool();
  process.env.DATABASE_URL =
    "postgresql://invalid:invalid@127.0.0.1:1/world_signal_test";
  clearSnapshotCache();
  try {
    const live = await getSnapshot(new URLSearchParams("mode=live"), now);
    assert.equal(live.status, "unavailable");
    assert.equal(live.signals.length, 0);
    const demo = await getSnapshot(new URLSearchParams("mode=demo"), now);
    assert.equal(demo.mode, "demo");
    assert.equal(demo.signals.length, 14);
  } finally {
    await closePool();
    process.env.DATABASE_URL = testUrl;
  }
});

test("compact fire history preserves baselines, revisions and rollback while bounding raw retention", async () => {
  const { storeObservations } = await import("../src/database/observations");
  const { fireAggregates } = await import("../src/database/fire-history");
  const client = await getPool().connect();
  const previousMode = process.env.FIRMS_RAW_RETENTION_HOURS;
  let released = false;
  const original = (
    await client.query(
      "SELECT payload FROM signals WHERE provider='firms' AND resolved_at IS NULL",
    )
  ).rows[0].payload;
  const stored = (
    await client.query("SELECT * FROM observations WHERE provider='firms'")
  ).rows;
  const observations: Observation[] = stored.map((r) => ({
    id: r.id,
    provider: r.provider,
    upstreamId: r.upstream_id,
    type: r.type,
    latitude: r.latitude,
    longitude: r.longitude,
    timestamp: r.occurred_at.toISOString(),
    sourceUpdatedAt: r.source_updated_at.toISOString(),
    value: r.value,
    cellId: r.cell_id,
    quality: r.quality,
    sourceUrl: r.source_url,
    properties: r.properties,
    active: r.active,
  }));
  const batch: NormalizedBatch = {
    observations,
    received: observations.length,
    rejected: 0,
    sourceAsOf: now.toISOString(),
    coverageStart: new Date(now.getTime() - 8 * 86400000).toISOString(),
    coverageEnd: now.toISOString(),
  };
  const end = Math.floor((now.getTime() - 3 * 3600000) / 3600000) * 3600000;
  try {
    await storeObservations(client, "firms", batch, 48);
    const rawCount = Number(
      (
        await client.query(
          "SELECT count(*) FROM observations WHERE provider='firms'",
        )
      ).rows[0].count,
    );
    assert.ok(rawCount < observations.length);
    assert.equal(rawCount, 90);
    process.env.FIRMS_RAW_RETENTION_HOURS = "48";
    // Release the connection before recomputation: production uses a two-connection pool.
    client.release();
    released = true;
    await computeSignals(now);
    const compact = (
      await getPool().query("SELECT payload FROM signals WHERE id=$1", [
        original.id,
      ])
    ).rows[0].payload;
    assert.equal(compact.observedValue, original.observedValue);
    assert.equal(compact.expectedValue, original.expectedValue);
    assert.deepEqual(compact.baseline, original.baseline);
    assert.match(compact.methodology, /aggregated hourly/);
    const countBefore = (
      await getPool().query("SELECT count(*) FROM signal_evidence")
    ).rows[0].count;
    await computeSignals(new Date(now.getTime() + 60000));
    assert.equal(
      (await getPool().query("SELECT count(*) FROM signal_evidence")).rows[0]
        .count,
      countBefore,
    );
    const connection = await getPool().connect();
    try {
      await storeObservations(connection, "firms", batch, 48);
      assert.equal(
        (await fireAggregates(connection, end)).rows.find((r) => r.bucket === 0)
          .count,
        80,
      );
      const revision = {
        ...batch,
        sourceAsOf: new Date(now.getTime() + 120000).toISOString(),
        observations: observations.filter((o) => o.id !== "fixture-fire-0-0"),
      };
      await storeObservations(connection, "firms", revision, 48);
      assert.equal(
        (await fireAggregates(connection, end)).rows.find((r) => r.bucket === 0)
          .count,
        79,
      );
      // Replaying an older complete feed cannot resurrect a retracted detection.
      await storeObservations(connection, "firms", batch, 48);
      assert.equal(
        (await fireAggregates(connection, end)).rows.find((r) => r.bucket === 0)
          .count,
        79,
      );
      assert.equal(
        (
          await connection.query(
            "SELECT active FROM observations WHERE id='fixture-fire-0-0'",
          )
        ).rows[0].active,
        false,
      );
      const bad = {
        ...revision,
        observations: [...revision.observations, revision.observations[1]],
      };
      await assert.rejects(() =>
        storeObservations(connection, "firms", bad, 48),
      );
      assert.equal(
        (await fireAggregates(connection, end)).rows.find((r) => r.bucket === 0)
          .count,
        79,
      );
      await storeObservations(connection, "firms", revision, 48, 5);
      assert.equal(
        (await fireAggregates(connection, end)).rows.find((r) => r.bucket === 0)
          .count,
        79,
      );
      assert.ok(
        (
          await connection.query(
            "SELECT count(*)::int AS n FROM observations WHERE provider='firms' AND active",
          )
        ).rows[0].n <= 10,
      );
    } finally {
      connection.release();
    }
  } finally {
    if (!released) client.release();
    if (previousMode === undefined)
      delete process.env.FIRMS_RAW_RETENTION_HOURS;
    else process.env.FIRMS_RAW_RETENTION_HOURS = previousMode;
  }
});

test("aviation stale observations preserve an active alert; fresh normal activity resolves it", async () => {
  const { computeAviationSignals } = await import("../src/server/aviation");
  const point = (timestamp: string, value: number): Observation => ({
    id: `aviation-test:${timestamp}`,
    upstreamId: timestamp,
    provider: "adsblol",
    type: "aviation",
    latitude: 49,
    longitude: 6,
    timestamp,
    sourceUpdatedAt: timestamp,
    value,
    cellId: geographicCell(49, 6, "earthquake"),
    quality: 0.55,
    sourceUrl: "https://example.test/aviation",
    active: true,
    properties: {
      metric: "observed_airborne_aircraft_snapshot",
      seriesKey: "test-region",
      region: "Test region",
      radiusNm: 250,
      stepSeconds: 900,
      snapshotSeconds: 30,
    },
  });
  const points = Array.from({ length: 20 }, (_, i) =>
    point(new Date(now.getTime() - (i + 1) * 86400000).toISOString(), 40),
  );
  points.push(point(now.toISOString(), 10));
  const fixture: ObservationProvider = {
    id: "adsblol",
    name: "Aviation fixture",
    type: "aviation",
    fetchRawData: async () => ({
      data: null,
      fetchedAt: now.toISOString(),
      sourceAsOf: now.toISOString(),
      coverageStart: points[19].timestamp,
      coverageEnd: now.toISOString(),
      sourceUrl: "https://example.test/aviation",
    }),
    normalize: () => ({
      observations: points,
      received: points.length,
      rejected: 0,
      sourceAsOf: now.toISOString(),
      coverageStart: points[19].timestamp,
      coverageEnd: now.toISOString(),
    }),
  };
  await ingest(fixture, true, now);
  await computeAviationSignals(now);
  const getSignal = async () =>
    (
      await getPool().query(
        "SELECT resolved_at,payload FROM signals WHERE id='adsblol:disruption:test-region'",
      )
    ).rows[0];
  assert.equal((await getSignal()).payload.status, "active");
  await computeAviationSignals(new Date(now.getTime() + 2 * 3600000));
  assert.equal((await getSignal()).resolved_at, null);
  points[points.length - 1] = point(now.toISOString(), 40);
  await ingest(fixture, true, now);
  await computeAviationSignals(now);
  assert.equal((await getSignal()).payload.status, "resolved");
});
