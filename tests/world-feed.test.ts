import test from "node:test";
import assert from "node:assert/strict";
import { compactFeedEvents, worldFeed, signalFeedEvent } from "../src/events/feed";
import { demoSnapshot } from "../src/providers/demo";

test("world feed includes every observed signal system without leaking demo data", () => {
  const signals = demoSnapshot.signals.slice(0, 4).map((s, i) => ({
    ...s,
    id: `signal-${i}`,
    type: (["earthquake", "wildfire", "internet", "aviation"] as const)[i],
    provenance: "observed" as const,
    timestamp: `2026-09-24T0${i}:00:00Z`,
    updatedAt: "2026-09-24T12:00:00Z",
  }));
  const items = worldFeed([], [...signals, ...demoSnapshot.signals]);
  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((e) => e.type),
    ["aviation_disruption", "internet_outage", "wildfire", "earthquake"],
  );
  assert.equal(items[0].updatedAt, signals[3].timestamp);
  assert.equal(items[0].properties.signalId, signals[3].id);
  assert.equal(items[0].magnitude.value, signals[3].observedValue);
});

test("repeated same-id events do not duplicate the feed", () => {
  const event = signalFeedEvent({
    ...demoSnapshot.signals[0],
    provenance: "observed",
  });
  assert.equal(worldFeed([event, event], []).length, 1);
});

test("repeated fire clusters in one country-hour are compacted without deleting raw signals", () => {
  const events = [0, 1, 2].map((index) => signalFeedEvent({
    ...demoSnapshot.signals[0], id: `fire-${index}`, type: "wildfire", provenance: "observed",
    country: "Brazil", startedAt: "2026-09-25T10:20:00.000Z", timestamp: `2026-09-25T10:2${index}:00.000Z`,
  }));
  const compacted = compactFeedEvents(events);
  assert.equal(compacted.length, 1);
  assert.equal(compacted[0]?.properties.aggregationCount, 3);
  assert.equal(compacted[0]?.properties.signalId, "fire-2");
  assert.match(compacted[0]?.title ?? "", /Brazil/);
  assert.equal(events.length, 3);
});
