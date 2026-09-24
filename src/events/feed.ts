import type { WorldSignal } from "../core/types";
import type { WorldEvent } from "./types";

/** One display contract, retaining the original signal id for its evidence drawer. */
export function signalFeedEvent(signal: WorldSignal): WorldEvent {
  return {
    schemaVersion: 1,
    id: `signal:${signal.id}`,
    category:
      signal.type === "internet"
        ? "infrastructure"
        : signal.type === "aviation"
          ? "mobility"
          : "natural_hazard",
    type:
      signal.type === "internet"
        ? "internet_outage"
        : signal.type === "aviation"
          ? "aviation_disruption"
          : signal.type,
    title: signal.title,
    description: signal.description,
    status: signal.status === "resolved" ? "resolved" : "active",
    severity: signal.severity,
    confidence: signal.confidence,
    startedAt: signal.startedAt ?? signal.timestamp,
    // Collection/computation time is not a new observation.
    updatedAt: signal.timestamp,
    endedAt:
      signal.status === "resolved"
        ? (signal.updatedAt ?? signal.timestamp)
        : null,
    location: {
      latitude: signal.latitude,
      longitude: signal.longitude,
      geometryType: "point",
    },
    magnitude: {
      value: signal.observedValue,
      unit: signal.unit,
      description: signal.methodology,
    },
    source: {
      ...signal.source,
      provider: signal.providerId ?? signal.type,
      upstreamId: signal.id,
    },
    secondarySources: [],
    properties: {
      signalId: signal.id,
      country: signal.country,
      region: signal.region,
      provenance: signal.provenance,
    },
  };
}

export function worldFeed(events: WorldEvent[], signals: WorldSignal[]) {
  const items = new Map(events.map((event) => [event.id, event]));
  for (const signal of signals) {
    if (signal.provenance !== "observed") continue;
    const event = signalFeedEvent(signal);
    items.set(event.id, event);
  }
  return [...items.values()].sort(
    (a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      a.id.localeCompare(b.id),
  );
}
