import test from "node:test";
import assert from "node:assert/strict";
import {
  OpenMeteoMarineProvider,
  detectSstWarming,
} from "../src/events/providers/open-meteo-marine";

const now = new Date("2026-09-22T12:00:00Z");

function series(startC = 20, endC = 23) {
  const time: string[] = [];
  const values: number[] = [];
  const start = Date.parse("2026-09-15T00:00:00Z");
  for (let i = 0; i < 8 * 24; i++) {
    time.push(new Date(start + i * 3_600_000).toISOString().slice(0, 16));
    const ratio = i / (8 * 24 - 1);
    values.push(startC + (endC - startC) * ratio);
  }
  return { time, sea_surface_temperature: values };
}

test("SST detector promotes only material seven-day warming using data known by collection time", () => {
  assert.equal(detectSstWarming(series(20, 21), now), null);
  const event = detectSstWarming(series(20, 23), now);
  assert(event);
  assert.equal(event.severity, "notable");
  assert(event.deltaC >= 2);
  assert(Date.parse(event.updatedAt) <= now.getTime());
});

test("marine provider emits compact climate events and discards raw series", async () => {
  const regions = [
    { id: "test-ocean", name: "Test Ocean", latitude: 10, longitude: -30 },
  ] as const;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("past_days"), "7");
    assert.equal(url.searchParams.get("forecast_days"), "1");
    assert.equal(url.searchParams.get("cell_selection"), "sea");
    return new Response(
      JSON.stringify({
        latitude: 10,
        longitude: -30,
        hourly: series(20, 24),
      }),
      { status: 200 },
    );
  };
  const events = await new OpenMeteoMarineProvider({
    fetcher,
    regions,
    batchSize: 1,
  }).fetchEvents({ now });
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.type, "water_anomaly");
  assert.equal(event.category, "climate");
  assert.equal(event.properties.marineHeatwave, false);
  assert.equal(event.properties.modelled, true);
  assert.equal(event.source.provider, "open-meteo-marine");
  assert.equal("hourly" in event.properties, false);
  assert(Date.parse(event.updatedAt) <= now.getTime());
});

test("marine provider fails on location-count mismatch instead of inventing coverage", async () => {
  const regions = [
    { id: "a", name: "A", latitude: 0, longitude: 0 },
    { id: "b", name: "B", latitude: 10, longitude: 10 },
  ] as const;
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ hourly: series(20, 23) }), { status: 200 });
  await assert.rejects(
    () => new OpenMeteoMarineProvider({ fetcher, regions }).fetchEvents({ now }),
    /location count mismatch/,
  );
});
