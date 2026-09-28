import test from "node:test";
import assert from "node:assert/strict";
import { NoaaSpaceWeatherProvider } from "../src/events/providers/noaa-space-weather";
import { NoaaTsunamiProvider } from "../src/events/providers/noaa-tsunami";

const response = (body: string) => (async () => new Response(body, { status: 200 })) as typeof fetch;

test("NOAA SWPC promotes only geomagnetic Kp 5+ alerts", async () => {
  const provider = new NoaaSpaceWeatherProvider(response(JSON.stringify([
    { product_id: "K04A", issue_datetime: "2026-09-28T01:00:00Z", message: "ALERT: Geomagnetic K-index of 4" },
    { product_id: "K06A", issue_datetime: "2026-09-28T02:00:00Z", message: "ALERT: Geomagnetic K-index of 6" },
  ])));
  const events = await provider.fetchEvents({ now: new Date("2026-09-28T03:00:00Z") });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "geomagnetic_storm");
  assert.equal(events[0].severity, "elevated");
  assert.match(events[0].description ?? "", /does not establish local disruption/);
});

test("NOAA tsunami feed excludes information statements and retains official warnings", async () => {
  const xml = `<feed><entry><id>info</id><title>Information</title><updated>2026-09-28T01:00:00Z</updated><geo:lat>1</geo:lat><geo:long>2</geo:long><summary>Category: Information</summary></entry><entry><id>warning</id><title>Test coast</title><updated>2026-09-28T02:00:00Z</updated><geo:lat>3</geo:lat><geo:long>4</geo:long><summary>Category: Warning</summary></entry></feed>`;
  const events = await new NoaaTsunamiProvider(response(xml)).fetchEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tsunami");
  assert.equal(events[0].severity, "significant");
  assert.equal(events[0].location.latitude, 3);
});

test("an information bulletin mentioning a warning is still excluded", async () => {
  const xml = `<feed><entry><id>info</id><title>Information</title><updated>2026-09-28T01:00:00Z</updated><geo:lat>1</geo:lat><geo:long>2</geo:long><summary type="xhtml"><div><strong>Category:</strong> Information<br/>There is NO tsunami warning.</div></summary></entry></feed>`;
  assert.equal((await new NoaaTsunamiProvider(response(xml)).fetchEvents()).length, 0);
});
