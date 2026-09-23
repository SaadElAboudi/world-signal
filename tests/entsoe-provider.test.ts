import test from "node:test";
import assert from "node:assert/strict";
import {
  EntsoeActualLoadProvider,
  parseEntsoeActualLoad,
} from "../src/providers/entsoe";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GL_MarketDocument>
  <TimeSeries>
    <Period>
      <timeInterval><start>2026-09-23T00:00Z</start><end>2026-09-23T03:00Z</end></timeInterval>
      <resolution>PT60M</resolution>
      <Point><position>1</position><quantity>42000</quantity></Point>
      <Point><position>2</position><quantity>41000</quantity></Point>
      <Point><position>3</position><quantity>40500</quantity></Point>
    </Period>
  </TimeSeries>
</GL_MarketDocument>`;

test("ENTSO-E parser extracts the latest actual system load point", () => {
  const parsed = parseEntsoeActualLoad(xml);
  assert.deepEqual(parsed, {
    timestamp: "2026-09-23T02:00:00.000Z",
    loadMw: 40500,
  });
});

test("ENTSO-E acknowledgement is treated as missing data, not zero load", () => {
  assert.equal(
    parseEntsoeActualLoad("<Acknowledgement_MarketDocument><Reason><code>999</code></Reason></Acknowledgement_MarketDocument>"),
    null,
  );
});

test("ENTSO-E provider preserves partial regional coverage", async () => {
  const regions = [
    { id: "a", name: "A", eic: "AREA-A", latitude: 1, longitude: 2 },
    { id: "b", name: "B", eic: "AREA-B", latitude: 3, longitude: 4 },
  ] as const;
  const requested: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url);
    if (url.searchParams.get("outBiddingZone_Domain") === "AREA-B")
      return new Response("<Acknowledgement_MarketDocument />", { status: 200 });
    return new Response(xml, { status: 200 });
  };
  const provider = new EntsoeActualLoadProvider({
    token: "secret-token",
    regions,
    fetcher,
  });
  const result = await provider.fetchLoads(new Date("2026-09-23T04:00:00Z"));
  assert.equal(result.observations.length, 1);
  assert.deepEqual(result.failedRegions, ["b"]);
  assert.equal(result.observations[0].region.id, "a");
  assert.equal(requested.length, 2);
  assert.equal(requested[0].searchParams.get("documentType"), "A65");
  assert.equal(requested[0].searchParams.get("processType"), "A16");
  assert.equal(requested[0].searchParams.get("securityToken"), "secret-token");
});
