import test from "node:test";
import assert from "node:assert/strict";
import {
  EntsoePowerProvider,
  parseEntsoeUnavailability,
} from "../src/events/providers/entsoe";

const zone = {
  id: "fr",
  name: "France",
  eic: "10YFR-RTE------C",
  latitude: 46.2,
  longitude: 2.2,
};

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Unavailability_MarketDocument>
  <TimeSeries>
    <mRID>outage-123</mRID>
    <businessType>A54</businessType>
    <production_RegisteredResource.name>Example plant</production_RegisteredResource.name>
    <Reason><text>Forced outage</text></Reason>
    <Period>
      <timeInterval>
        <start>2026-09-23T06:00Z</start>
        <end>2026-09-23T18:00Z</end>
      </timeInterval>
    </Period>
  </TimeSeries>
</Unavailability_MarketDocument>`;

test("ENTSO-E parser labels forced unavailability without claiming customer outage", () => {
  const events = parseEntsoeUnavailability(
    xml,
    zone,
    new Date("2026-09-23T10:00:00Z"),
  );
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.type, "power_grid_disruption");
  assert.equal(event.status, "active");
  assert.equal(event.properties.customerOutageConfirmed, false);
  assert.match(event.description ?? "", /does not by itself prove/i);
  assert.equal(event.source.provider, "entsoe");
});

test("ENTSO-E provider sends bounded forced-unavailability queries", async () => {
  let requested = "";
  const fetcher: typeof fetch = async (input) => {
    requested = String(input);
    return new Response(xml, { status: 200 });
  };
  const events = await new EntsoePowerProvider({
    token: "test-token",
    fetcher,
    zones: [zone],
  }).fetchEvents({ now: new Date("2026-09-23T10:00:00Z") });
  assert.equal(events.length, 1);
  const url = new URL(requested);
  assert.equal(url.searchParams.get("documentType"), "A80");
  assert.equal(url.searchParams.get("businessType"), "A54");
  assert.equal(url.searchParams.get("biddingZone_Domain"), zone.eic);
  assert.equal(url.searchParams.get("securityToken"), "test-token");
});
