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

/**
 * Keep raw observations available to the map and API, but collapse repeated
 * thermal-cluster cards in the human feed. A group is intentionally narrow:
 * same country and the same UTC hour, with at least three distinct clusters.
 */
export function compactFeedEvents(events: WorldEvent[]) {
  const groups = new Map<string, WorldEvent[]>();
  for (const event of events) {
    const signalId = event.properties.signalId;
    const country = event.properties.country;
    const eligible =
      event.type === "wildfire" &&
      typeof signalId === "string" &&
      typeof country === "string";
    if (!eligible) continue;
    const hour = new Date(event.startedAt).toISOString().slice(0, 13);
    const key = `${country}:${hour}`;
    const members = groups.get(key) ?? [];
    members.push(event);
    groups.set(key, members);
  }
  const compacted = new Map(events.map((event) => [event.id, event]));
  for (const [key, members] of groups) {
    if (members.length < 3) continue;
    const [country] = key.split(":");
    const primary = [...members].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )[0]!;
    compacted.set(primary.id, {
      ...primary,
      title: `Unusual thermal activity — ${country}`,
      description: `${members.length} independent thermal-anomaly clusters were detected in this country during the same UTC hour. This is a feed summary, not a verified single wildfire incident.`,
      magnitude: { value: null, unit: null, description: primary.magnitude.description },
      properties: {
        ...primary.properties,
        aggregationCount: members.length,
        aggregationSignalIds: members
          .map((member) => member.properties.signalId)
          .filter((id): id is string => typeof id === "string")
          .join(","),
      },
    });
    for (const member of members) if (member.id !== primary.id) compacted.delete(member.id);
  }
  return [...compacted.values()].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id),
  );
}
