import test from "node:test";
import assert from "node:assert/strict";
import { createBudgetedFetch } from "../src/server/budgeted-fetch";
import { providerBudget } from "../src/server/resource-budget";

test("every attempted network request spends quota, including failed requests", async () => {
  let used = 0,
    fetched = 0;
  const request = createBudgetedFetch("eonet", {
    cooldown: async () => false,
    defer: async () => {},
    reserve: async () => ({ allowed: ++used <= 2 }),
    fetcher: async () => {
      fetched++;
      throw new Error("network");
    },
  });
  await assert.rejects(request("https://example.org"), /network/);
  await assert.rejects(request("https://example.org"), /network/);
  await assert.rejects(request("https://example.org"), /api_budget_exhausted/);
  assert.equal(fetched, 2);
});

test("429 persists the entire Retry-After and blocks subsequent calls before spending quota", async () => {
  let blocked = false,
    until = 0,
    used = 0;
  const now = Date.parse("2026-09-24T00:00:00Z");
  const request = createBudgetedFetch("adsblol", {
    now: () => now,
    cooldown: async () => blocked,
    defer: async (date) => {
      until = date.getTime();
      blocked = true;
    },
    reserve: async () => {
      used++;
      return { allowed: true };
    },
    fetcher: async () =>
      new Response("", { status: 429, headers: { "retry-after": "7200" } }),
  });
  assert.equal((await request("https://example.org")).status, 429);
  assert.equal(until, now + 7200000);
  await assert.rejects(request("https://example.org"), /provider_cooldown/);
  assert.equal(used, 1);
});

test("weather multi-location and archive requests reserve conservative units", async () => {
  let units = 0;
  const request = createBudgetedFetch("open-meteo", {
    cooldown: async () => false,
    defer: async () => {},
    reserve: async (n) => {
      units = n;
      return { allowed: true };
    },
    fetcher: async () => new Response("{}"),
  });
  await request(
    "https://example.org?latitude=1,2,3&start_date=2026-01-01&end_date=2026-01-28",
  );
  assert.equal(units, 6);
});

test("zero API limits explicitly disable calls", () => {
  const previous = process.env.API_BUDGET_EONET_DAILY;
  process.env.API_BUDGET_EONET_DAILY = "0";
  try {
    assert.equal(providerBudget("eonet").daily, 0);
  } finally {
    if (previous === undefined) delete process.env.API_BUDGET_EONET_DAILY;
    else process.env.API_BUDGET_EONET_DAILY = previous;
  }
});
