import test from "node:test";
import assert from "node:assert/strict";
import { OpenMeteoExtremeWeatherProvider } from "../src/events/providers/open-meteo";

function hours() {
  return Array.from({ length: 24 }, (_, index) => `2026-09-22T${String(index).padStart(2, "0")}:00`);
}

function benign() {
  return {
    latitude: 0,
    longitude: 0,
    hourly: {
      time: hours(),
      temperature_2m: Array(24).fill(20),
      precipitation: Array(24).fill(0),
      wind_gusts_10m: Array(24).fill(20),
    },
  };
}

test("Open-Meteo provider scans all coarse global cells in bounded batches", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    const url = new URL(String(input));
    const count = url.searchParams.get("latitude")!.split(",").length;
    assert.equal(url.searchParams.get("forecast_hours"), "24");
    assert.equal(url.searchParams.get("timezone"), "UTC");
    assert.match(url.searchParams.get("hourly")!, /temperature_2m/);
    return new Response(JSON.stringify(Array.from({ length: count }, () => benign())), { status: 200 });
  };

  const events = await new OpenMeteoExtremeWeatherProvider({ fetcher, batchSize: 20 }).fetchEvents({
    now: new Date("2026-09-22T12:00:00Z"),
  });

  assert.equal(events.length, 0);
  assert.equal(calls, 7);
});

test("Open-Meteo provider emits compact heat, wind and heavy-rain events", async () => {
  let first = true;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const count = url.searchParams.get("latitude")!.split(",").length;
    const rows = Array.from({ length: count }, () => benign());
    if (first) {
      first = false;
      rows[0] = benign();
      rows[0].hourly.temperature_2m[8] = 46;
      rows[0].hourly.wind_gusts_10m[10] = 125;
      rows[0].hourly.precipitation.splice(12, 6, 15, 15, 15, 15, 15, 15);
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  };

  const events = await new OpenMeteoExtremeWeatherProvider({ fetcher, batchSize: 50 }).fetchEvents({
    now: new Date("2026-09-22T12:00:00Z"),
  });

  assert.equal(events.length, 3);
  const heat = events.find((event) => event.type === "temperature_extreme");
  const wind = events.find((event) => event.type === "high_wind");
  const rain = events.find((event) => event.type === "heavy_rain");
  assert.equal(heat?.severity, "significant");
  assert.equal(heat?.magnitude.value, 46);
  assert.equal(wind?.severity, "significant");
  assert.equal(wind?.magnitude.value, 125);
  assert.equal(rain?.severity, "significant");
  assert.equal(rain?.magnitude.value, 90);
  assert.equal(rain?.magnitude.unit, "mm/6h");
  assert.equal(heat?.properties.grid, "h3-r0-centroid");
  assert.equal(heat?.properties.forecast, true);
  assert.match(heat?.id ?? "", /^open-meteo:/);
});

test("Open-Meteo provider can use the commercial endpoint and API key without changing normalization", async () => {
  let requested = "";
  const fetcher: typeof fetch = async (input) => {
    requested = String(input);
    const count = new URL(requested).searchParams.get("latitude")!.split(",").length;
    return new Response(JSON.stringify(Array.from({ length: count }, () => benign())), { status: 200 });
  };
  await new OpenMeteoExtremeWeatherProvider({
    fetcher,
    endpoint: "https://customer-api.open-meteo.com/v1/forecast",
    apiKey: "test-key",
    batchSize: 50,
  }).fetchEvents();
  const url = new URL(requested);
  assert.equal(url.host, "customer-api.open-meteo.com");
  assert.equal(url.searchParams.get("apikey"), "test-key");
});
