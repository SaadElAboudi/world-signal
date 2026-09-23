import test from "node:test";
import assert from "node:assert/strict";
import { AdsbLolProvider } from "../src/providers/adsblol";

const now = new Date("2026-09-22T20:07:00.000Z");

function response(ac: unknown[]) {
  return new Response(
    JSON.stringify({
      ac,
      total: ac.length,
      ctime: 1,
      ptime: 1,
      now: now.getTime(),
      msg: "No error",
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

test("ADSB.lol provider retains only aggregated fresh airborne counts", async () => {
  const provider = new AdsbLolProvider({
    sentinels: [
      {
        id: "test",
        name: "Test Airspace",
        latitude: 48,
        longitude: 2,
        radiusNm: 250,
      },
    ],
    fetchImpl: (async () =>
      response([
        {
          hex: "abc123",
          lat: 48,
          lon: 2,
          seen: 1,
          seen_pos: 2,
          alt_baro: 32000,
        },
        {
          hex: "abc123",
          lat: 48.1,
          lon: 2.1,
          seen: 1,
          seen_pos: 3,
          alt_baro: 32100,
        },
        {
          hex: "def456",
          lat: 48.2,
          lon: 2.2,
          seen: 2,
          seen_pos: 2,
          alt_baro: 28000,
        },
        {
          hex: "111111",
          lat: 48.3,
          lon: 2.3,
          seen: 2,
          seen_pos: 35,
          alt_baro: 20000,
        },
        {
          hex: "222222",
          lat: 48.4,
          lon: 2.4,
          seen: 1,
          seen_pos: 1,
          alt_baro: "ground",
        },
      ])) as typeof fetch,
  });
  const raw = await provider.fetchRawData({ now, history: false });
  const batch = provider.normalize(raw);
  assert.equal(batch.observations.length, 1);
  const observation = batch.observations[0];
  assert.equal(observation.value, 2);
  assert.equal(observation.type, "aviation");
  assert.equal(observation.properties.seriesKey, "test");
  assert.equal(observation.properties.individualAircraftRetained, false);
  assert.equal(observation.timestamp, "2026-09-22T20:00:00.000Z");
  assert(!JSON.stringify(batch).includes("abc123"));
  assert(!JSON.stringify(batch).includes("def456"));
});

test("ADSB.lol provider rejects an upstream failure rather than inventing zero traffic", async () => {
  const provider = new AdsbLolProvider({
    sentinels: [
      {
        id: "test",
        name: "Test Airspace",
        latitude: 48,
        longitude: 2,
        radiusNm: 250,
      },
    ],
    fetchImpl: (async () =>
      new Response("down", { status: 503 })) as typeof fetch,
  });
  await assert.rejects(
    () => provider.fetchRawData({ now, history: false }),
    /503/,
  );
});

test("ADSB.lol rejects stale successful responses", async () => {
  const provider = new AdsbLolProvider({
    sentinels: [
      { id: "test", name: "Test", latitude: 48, longitude: 2, radiusNm: 250 },
    ],
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({ ac: [], total: 0, now: now.getTime() - 3600000 }),
      )) as typeof fetch,
  });
  await assert.rejects(
    () => provider.fetchRawData({ now, history: false }),
    /stale/,
  );
});
