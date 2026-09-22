import test from "node:test";
import assert from "node:assert/strict";
import { IodaInternetOutageProvider } from "../src/events/providers/ioda";

const now = new Date("2026-09-22T18:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);

function response(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("IODA outage provider emits compact infrastructure events", async () => {
  let requested = "";
  const provider = new IodaInternetOutageProvider({
    fetchImpl: (async (input) => {
      requested = String(input);
      return response([
        {
          datasource: "ping-slash24",
          location: "country/IR",
          start: nowSeconds - 3600,
          duration: 3600,
          status: 1,
          score: 1200,
          location_name: "Iran",
          overlaps_window: false,
        },
      ]);
    }) as typeof fetch,
    resolveLocation: async () => ({ latitude: 32, longitude: 54 }),
  });
  const events = await provider.fetchEvents({ now, days: 2, limit: 100 });
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.category, "infrastructure");
  assert.equal(event.type, "internet_outage");
  assert.equal(event.status, "active");
  assert.equal(event.severity, "significant");
  assert.equal(event.source.provider, "ioda");
  assert.equal(event.properties.countryCode, "IR");
  assert.equal(event.properties.datasource, "ping-slash24");
  assert.equal(event.location.latitude, 32);
  assert.match(requested, /entityType=country/);
  assert.match(requested, /format=codf/);
  assert.match(requested, /orderBy=time%2Fdesc/);
});

test("IODA outage provider resolves old events and skips unsupported geography", async () => {
  const provider = new IodaInternetOutageProvider({
    fetchImpl: (async () =>
      response([
        {
          datasource: "bgp",
          location: "country/BR",
          start: nowSeconds - 7200,
          duration: 1800,
          score: 300,
          location_name: "Brazil",
        },
        {
          datasource: "bgp",
          location: "region/3083",
          start: nowSeconds - 600,
          duration: 600,
          score: 400,
          location_name: "Azad Kashmir",
        },
      ])) as typeof fetch,
    resolveLocation: async (code) =>
      code === "BR" ? { latitude: -10, longitude: -52 } : null,
  });
  const events = await provider.fetchEvents({ now });
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "resolved");
  assert.equal(events[0].endedAt, new Date((nowSeconds - 5400) * 1000).toISOString());
  assert.equal(events[0].severity, "elevated");
});

test("IODA outage provider fails closed on malformed upstream responses", async () => {
  const provider = new IodaInternetOutageProvider({
    fetchImpl: (async () => response([{ datasource: "bgp", location: "country/IR" }])) as typeof fetch,
    resolveLocation: async () => ({ latitude: 32, longitude: 54 }),
  });
  await assert.rejects(() => provider.fetchEvents({ now }));
});
