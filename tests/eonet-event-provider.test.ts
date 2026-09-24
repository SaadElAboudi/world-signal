import test from "node:test";
import assert from "node:assert/strict";
import { EonetEventProvider } from "../src/events/providers/eonet";

test("EONET provider maps natural events into the universal contract", async () => {
  let requested = "";
  const fetcher: typeof fetch = async (input) => {
    requested = String(input);
    return new Response(
      JSON.stringify({
        events: [
          {
            id: "EONET_1",
            title: "Example volcano",
            description: "Volcanic activity",
            categories: [{ id: "volcanoes", title: "Volcanoes" }],
            sources: [
              { id: "EO", url: "https://example.test/event" },
              { id: "S2", url: "https://example.test/secondary" },
            ],
            geometry: [
              {
                date: "2026-09-21T10:00:00Z",
                type: "Point",
                coordinates: [15.1, 37.7],
              },
              {
                date: "2026-09-22T10:00:00Z",
                type: "Point",
                coordinates: [15.2, 37.8],
              },
            ],
            closed: null,
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const events = await new EonetEventProvider(fetcher).fetchEvents({
    now: new Date("2026-09-22T12:00:00Z"),
    days: 14,
  });
  assert.match(requested, /status=all/);
  assert.match(requested, /days=14/);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.category, "natural_hazard");
  assert.equal(events[0]?.type, "volcano");
  assert.equal(events[0]?.status, "active");
  assert.equal(events[0]?.location.latitude, 37.8);
  assert.equal(events[0]?.location.longitude, 15.2);
  assert.equal(events[0]?.secondarySources.length, 1);
});

test("EONET provider compacts polygons and preserves recently closed events", async () => {
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        events: [
          {
            id: "EONET_2",
            title: "Example flood",
            categories: [{ id: "floods" }],
            sources: [{ id: "NASA", url: "https://example.test/flood" }],
            geometry: [
              {
                date: "2026-09-20T00:00:00Z",
                type: "Polygon",
                coordinates: [
                  [
                    [10, 40],
                    [12, 40],
                    [12, 42],
                    [10, 42],
                    [10, 40],
                  ],
                ],
              },
            ],
            closed: "2026-09-22T09:00:00Z",
          },
          {
            id: "broken",
            title: "No geometry",
            categories: [{ id: "wildfires" }],
            geometry: [],
          },
        ],
      }),
      { status: 200 },
    );
  const events = await new EonetEventProvider(fetcher).fetchEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "flood");
  assert.equal(events[0]?.status, "resolved");
  assert.equal(events[0]?.endedAt, "2026-09-22T09:00:00Z");
  assert.deepEqual(events[0]?.location.bbox, [10, 40, 12, 42]);
  assert.equal(events[0]?.location.latitude, 41);
  assert.equal(events[0]?.location.longitude, 11);
});

test("invalid upstream coordinates cannot abort ingestion of valid EONET events", async () => {
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        events: [
          {
            id: "bad",
            title: "Invalid latitude",
            geometry: [
              {
                date: "2026-09-22T00:00:00Z",
                type: "Point",
                coordinates: [10, 150],
              },
            ],
          },
          {
            id: "good",
            title: "Valid event",
            geometry: [
              {
                date: "2026-09-22T00:00:00Z",
                type: "Point",
                coordinates: [10, 40],
              },
            ],
          },
        ],
      }),
    );
  const events = await new EonetEventProvider(fetcher).fetchEvents();
  assert.deepEqual(
    events.map((e) => e.id),
    ["eonet:good"],
  );
});
