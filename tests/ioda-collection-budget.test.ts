import test from "node:test";
import assert from "node:assert/strict";
import { IodaProvider, internetCountries } from "../src/providers/ioda";

test("a failed IODA scope is attempted once so outages do not multiply the worker runtime", async () => {
  let calls = 0;
  const provider = new IodaProvider({
    fetcher: async () => {
      calls++;
      throw new Error("unavailable");
    },
  });
  await assert.rejects(
    provider.fetchRawData({ now: new Date(), history: false }),
    /all_scopes_unavailable/,
  );
  assert.equal(calls, internetCountries().length);
});

test("IODA stops scheduling network calls after its 90-second allowance", async () => {
  let elapsed = 0,
    calls = 0;
  const provider = new IodaProvider({
    now: () => elapsed,
    fetcher: async () => {
      calls++;
      elapsed += 45001;
      throw new Error("unavailable");
    },
  });
  await assert.rejects(
    provider.fetchRawData({ now: new Date(), history: false }),
    /all_scopes_unavailable/,
  );
  assert.equal(calls, 2);
});
