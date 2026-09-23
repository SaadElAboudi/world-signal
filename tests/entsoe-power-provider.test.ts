import test from "node:test";
import assert from "node:assert/strict";
import { EntsoeGridLoadProvider, parseEntsoeSeries } from "../src/events/providers/entsoe";

function xml(values: number[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<GL_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-6:generationloaddocument:3:0">
  <TimeSeries>
    <Period>
      <timeInterval><start>2026-09-23T06:00Z</start><end>2026-09-23T10:00Z</end></timeInterval>
      <resolution>PT60M</resolution>
      ${values.map((value, index) => `<Point><position>${index + 1}</position><quantity>${value}</quantity></Point>`).join("")}
    </Period>
  </TimeSeries>
</GL_MarketDocument>`;
}

test("ENTSO-E parser reconstructs timestamped quantities", () => {
  const points = parseEntsoeSeries(xml([1000, 1100, 1200]));
  assert.equal(points.length, 3);
  assert.equal(points[1].quantityMw, 1100);
  assert.equal(new Date(points[1].timestamp).toISOString(), "2026-09-23T07:00:00.000Z");
});

test("ENTSO-E provider promotes a material actual-vs-forecast shortfall", async () => {
  const zone = { id: "test", name: "Test Grid", eic: "10YTEST---------1", latitude: 48, longitude: 2 };
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("documentType"), "A65");
    assert.equal(url.searchParams.get("outBiddingZone_Domain"), zone.eic);
    const process = url.searchParams.get("processType");
    return new Response(process === "A16" ? xml([900, 900, 700, 700]) : xml([1000, 1000, 1000, 1000]), { status: 200 });
  };
  const events = await new EntsoeGridLoadProvider({
    token: "test-token",
    fetcher,
    zones: [zone],
  }).fetchEvents({ now: new Date("2026-09-23T09:30:00Z") });
  assert.equal(calls, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "grid_load_anomaly");
  assert.equal(events[0].severity, "elevated");
  assert.equal(events[0].properties.notConfirmedOutage, true);
  assert.equal(events[0].properties.requestBudgetPerRun, 2);
});

test("ENTSO-E provider does not call normal demand variation a power outage", async () => {
  const zone = { id: "test", name: "Test Grid", eic: "10YTEST---------1", latitude: 48, longitude: 2 };
  const fetcher: typeof fetch = async (input) => {
    const process = new URL(String(input)).searchParams.get("processType");
    return new Response(process === "A16" ? xml([980, 970, 960, 950]) : xml([1000, 1000, 1000, 1000]), { status: 200 });
  };
  const events = await new EntsoeGridLoadProvider({ token: "x", fetcher, zones: [zone] }).fetchEvents({
    now: new Date("2026-09-23T09:30:00Z"),
  });
  assert.equal(events.length, 0);
});
