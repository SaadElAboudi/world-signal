import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UsgsProvider } from "../src/providers/usgs";
import { FirmsProvider } from "../src/providers/nasa-firms";
import { fetchText } from "../src/providers/http";
import {
  rollingMean,
  mergeCoverage,
  windowCovered,
} from "../src/signals/baseline";
import { dataConfidence } from "../src/signals/confidence";
import { geographicCell } from "../src/signals/geography";
import { thresholdSeverity, earthquakeSeverity } from "../src/signals/rules";
import {
  buildClusterSignals,
  individualEarthquake,
  type CellAggregate,
} from "../src/signals/engine";
import { getConfig } from "../src/server/config";
import { parseSignalQuery, matchesQuery, querySql } from "../src/server/query";
import { classifyHealth } from "../src/server/health";
import { demoSnapshot } from "../src/providers/demo";
import { errorCode } from "../src/server/log";
const asOf = "2026-09-17T02:00:00.000Z";
const raw = <T>(data: T) => ({
  data,
  fetchedAt: asOf,
  sourceAsOf: asOf,
  coverageStart: "2026-09-10T02:00:00.000Z",
  coverageEnd: asOf,
  sourceUrl: "https://example.test/reference",
});
const usgs = JSON.parse(readFileSync("tests/fixtures/usgs.json", "utf8"));
const csv = readFileSync("tests/fixtures/firms.csv", "utf8");
test("USGS normalization preserves identifiers, metadata and missing values", () => {
  const result = new UsgsProvider().normalize(raw(usgs));
  assert.equal(result.received, 2);
  assert.equal(result.rejected, 0);
  assert.equal(result.observations[0].value, 5.8);
  assert.equal(result.observations[0].properties.depth, 32);
  assert.equal(result.observations[1].value, null);
  assert.equal(result.observations[1].properties.depth, null);
  assert.equal(
    result.observations[0].id,
    new UsgsProvider().normalize(raw(usgs)).observations[0].id,
  );
});
test("provider rejects malformed coordinates and does not invent measurements", () => {
  const changed = structuredClone(usgs);
  changed.features[0].geometry.coordinates[1] = 999;
  assert.equal(new UsgsProvider().normalize(raw(changed)).rejected, 1);
  assert.throws(() => new UsgsProvider().normalize(raw({ features: [] })));
});
test("FIRMS accepts public and API confidence formats, excludes invalid FRP without fabricating power", () => {
  const result = new FirmsProvider().normalize(raw(csv));
  assert.equal(result.rejected, 0);
  assert.equal(result.observations.length, 3);
  assert.equal(result.observations[0].quality, 0.7);
  assert.equal(result.observations[1].quality, 1);
  assert.equal(result.observations[2].value, null);
  assert.equal(result.observations[2].properties.rawFrp, -0.5);
  assert.equal(result.observations[0].properties.instrument, "VIIRS");
});
test("fire identity is stable across repeated downloads; malformed timestamps are rejected", () => {
  const provider = new FirmsProvider();
  const rows = csv.trim().split("\n");
  const repeated = csv + rows[1] + "\n";
  assert.equal(provider.normalize(raw(repeated)).observations.length, 3);
  assert.equal(
    provider.normalize(raw(csv.replace("2300", "2460"))).rejected,
    1,
  );
  assert.equal(
    geographicCell(-5.5, -57, "wildfire"),
    geographicCell(-5.51, -57.01, "wildfire"),
  );
});
test("rolling statistics require sufficient, covered history and nonzero reference", () => {
  const result = rollingMean.calculate(20, [2, 4, 2, 4, 3], 5, 10);
  assert.equal(result.mean, 3);
  assert.equal(result.ratio, 20 / 3);
  assert.ok(result.zscore! > 10);
  assert.equal(
    rollingMean.calculate(20, [0, 0, 0, 0, 0], 5, 1).available,
    false,
  );
  assert.equal(rollingMean.calculate(20, [2, 2, 2, 2], 5, 1).available, false);
  assert.equal(rollingMean.calculate(20, [2, 2, 2, 2, 2], 5, 1).zscore, null);
  const coverage = mergeCoverage([
    { start: 0, end: 10 },
    { start: 5, end: 20 },
    { start: 30, end: 40 },
  ]);
  assert.equal(windowCovered(0, 20, coverage), true);
  assert.equal(windowCovered(0, 40, coverage), false);
});
test("confidence depends on history and freshness; provisional baseline cannot claim HIGH", () => {
  const input = {
    quality: 1,
    currentCount: 100,
    historySamples: 30,
    targetSamples: 30,
    coefficientOfVariation: 0.1,
    ageHours: 0,
    freshnessHours: 4,
  };
  assert.ok(dataConfidence(input) > 0.8);
  assert.ok(dataConfidence({ ...input, historySamples: 6 }) < 0.6);
  assert.ok(dataConfidence({ ...input, ageHours: 4 }) < dataConfidence(input));
});
test("event thresholds are distinct from statistical anomaly rules", () => {
  const config = getConfig();
  assert.equal(earthquakeSeverity(2, 5, 30, config), null);
  assert.equal(earthquakeSeverity(6, 100, 10, config), "significant");
  assert.equal(thresholdSeverity(1.9, [2, 3, 4]), null);
  assert.equal(thresholdSeverity(3, [2, 3, 4]), "elevated");
  const observation = new UsgsProvider().normalize(raw(usgs)).observations[0];
  const signal = individualEarthquake(observation, config, new Date(asOf));
  assert.equal(signal?.expectedValue, null);
  assert.equal(signal?.deviation, null);
  assert.equal(signal?.kind, "earthquake-event");
});
test("fire engine aggregates pixels, excludes current window and labels short references", () => {
  const end = Date.parse(asOf),
    day = 86400000,
    cell = geographicCell(-5.5, -57, "wildfire");
  const rows: CellAggregate[] = Array.from({ length: 7 }, (_, bucket) => ({
    cell_id: cell,
    bucket,
    count: bucket === 0 ? 80 : 10,
    mean_quality: 0.8,
    frp_total: 50,
    frp_count: 10,
    first_at: new Date(end - bucket * day - 3600000).toISOString(),
    last_at: new Date(end - bucket * day - 1000).toISOString(),
    ids: bucket === 0 ? ["observed-1"] : null,
    high: 3,
    nominal: 7,
    low: 0,
  }));
  const context = {
    provider: "firms" as const,
    end,
    now: end,
    sourceAsOf: asOf,
    coverage: [{ start: end - 7 * day, end }],
    config: getConfig(),
  };
  const signals = buildClusterSignals(rows, context);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].expectedValue, 10);
  assert.equal(signals[0].deviation, 8);
  assert.equal(signals[0].baseline.length, 6);
  assert.match(signals[0].baselineLabel!, /provisional/);
  assert.ok(signals[0].confidence < 0.6);
  assert.equal(
    buildClusterSignals(rows, {
      ...context,
      coverage: [{ start: end - 3 * day, end }],
    }).length,
    0,
  );
  assert.equal(
    buildClusterSignals(rows, {
      ...context,
      coverage: [{ start: end - 7 * day, end: end - day }],
    }).length,
    0,
  );
});
test("API validates query parameters and supports antimeridian boxes", () => {
  const q = parseSignalQuery(
    new URLSearchParams("type=earthquake&bbox=170,-90,-170,90"),
    demoSnapshot.asOf,
    "demo",
  );
  assert.equal(
    matchesQuery(
      demoSnapshot.signals.find((s) => s.country === "New Zealand")!,
      q,
    ),
    true,
  );
  assert.equal(
    matchesQuery(
      demoSnapshot.signals.find((s) => s.country === "Japan")!,
      q,
    ),
    false,
  );
  assert.throws(() =>
    parseSignalQuery(new URLSearchParams("bbox=1,2,3"), asOf, "live"),
  );
  assert.throws(() =>
    parseSignalQuery(new URLSearchParams("limit=99999"), asOf, "live"),
  );
  const sql = querySql(
    parseSignalQuery(new URLSearchParams("q=foo'%20OR%201=1"), asOf, "live"),
  );
  assert.ok(!sql.where.includes("OR 1=1"));
  assert.ok(sql.values.some((v) => String(v).includes("OR 1=1")));
});
test("provider health reflects source freshness, not only a recent HTTP fetch", () => {
  const now = new Date(asOf);
  const row = {
    provider: "usgs",
    status: "success",
    finished_at: now,
    error_code: null,
    success_at: now,
    source_as_of: new Date(now.getTime() - 3600000),
    latest_observation_at: now,
    records_received: 10,
    records_inserted: 10,
    records_updated: 0,
  };
  assert.equal(classifyHealth(row, "usgs", now).status, "delayed");
  assert.equal(
    classifyHealth({ ...row, source_as_of: now }, "usgs", now).status,
    "healthy",
  );
  assert.equal(
    classifyHealth({ ...row, source_as_of: now, status: "failed" }, "usgs", now)
      .status,
    "error",
  );
});
test("HTTP retries temporary failures, respects long rate limits and sanitizes secrets", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return new Response("ok");
  }) as typeof fetch;
  assert.equal(
    (
      await fetchText("https://example.test/key-secret", {
        fetcher,
        sleep: async () => {},
      })
    ).text,
    "ok",
  );
  assert.equal(calls, 2);
  await assert.rejects(
    () =>
      fetchText("https://example.test/secret", {
        fetcher: (async () =>
          new Response("", {
            status: 429,
            headers: { "retry-after": "3600" },
          })) as typeof fetch,
        sleep: async () => {},
      }),
    /rate_limited/,
  );
  assert.equal(errorCode(new Error("credential secret")), "internal_failure");
});
test("explicit FIRMS API mode reports missing credentials", async () => {
  const oldMode = process.env.FIRMS_TRANSPORT,
    oldKey = process.env.NASA_FIRMS_API_KEY;
  process.env.FIRMS_TRANSPORT = "api";
  delete process.env.NASA_FIRMS_API_KEY;
  try {
    await assert.rejects(
      () =>
        new FirmsProvider().fetchRawData({
          history: false,
          now: new Date(asOf),
        }),
      /missing_credentials/,
    );
  } finally {
    if (oldMode === undefined) delete process.env.FIRMS_TRANSPORT;
    else process.env.FIRMS_TRANSPORT = oldMode;
    if (oldKey === undefined) delete process.env.NASA_FIRMS_API_KEY;
    else process.env.NASA_FIRMS_API_KEY = oldKey;
  }
});
