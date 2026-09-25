import { test, expect } from "@playwright/test";
import { demoSnapshot } from "../../src/providers/demo";
import type { SignalSnapshot } from "../../src/core/types";
// Browser-only deterministic fixtures. These are intercepted responses, never seeded into the live database.
function fixtureSnapshot(): SignalSnapshot {
  const asOf = new Date().toISOString();
  const quake = {
    ...structuredClone(demoSnapshot.signals[0]),
    id: "browser-fixture-quake",
    kind: "earthquake-event" as const,
    provenance: "observed" as const,
    timestamp: asOf,
    sourceAsOf: asOf,
    expectedValue: null,
    baseline: [],
    confidence: 0.85,
    baselineLabel: "Magnitude threshold · no historical comparison",
  };
  const fire = {
    ...structuredClone(demoSnapshot.signals[1]),
    id: "browser-fixture-fire",
    kind: "fire-cluster" as const,
    provenance: "observed" as const,
    timestamp: asOf,
    sourceAsOf: asOf,
    confidence: 0.5,
    baselineLabel: "6 daily reference windows · provisional",
    baseline: structuredClone(demoSnapshot.signals[1].baseline).slice(0, 6),
  };
  return {
    mode: "live",
    asOf,
    status: "live",
    signals: [quake, fire],
    total: 2,
    providers: [
      {
        id: "usgs",
        name: "USGS",
        status: "healthy",
        lastSuccessAt: asOf,
        lastAnalysisAt: asOf,
        sourceAsOf: asOf,
        latestObservationAt: asOf,
      },
      {
        id: "firms",
        name: "NASA FIRMS",
        status: "healthy",
        lastSuccessAt: asOf,
        lastAnalysisAt: asOf,
        sourceAsOf: asOf,
        latestObservationAt: asOf,
      },
    ],
  };
}
test("live provenance, nullable event baselines, provisional fire references and delayed data remain explicit", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let snapshot = fixtureSnapshot();
  await page.route("**/api/signals?*", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/events?*", (route) =>
    route.fulfill({ json: { events: [] } }),
  );
  await page.goto("/?mode=live");
  await expect(page.getByRole("button", { name: "2/2 sources current" })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".world-feed-card")).toHaveCount(2);
  await page.locator(".world-feed-card").filter({ hasText: "Japan" }).click();
  await expect(page.getByText("OBSERVED EVENT", { exact: true })).toBeVisible();
  await expect(page.getByText("N/A", { exact: true })).toBeVisible();
  await expect(page.getByText("Data confidence · HIGH")).toBeVisible();
  await expect(page.getByText("SIMULATED", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close signal details" }).click();
  await page.locator(".world-feed-card").filter({ hasText: "Brazil" }).click();
  await expect(
    page.getByText("STATISTICAL ANOMALY", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("6 daily reference windows · provisional"),
  ).toBeVisible();
  await expect(page.getByText("Data confidence · LOW")).toBeVisible();
  await page.getByRole("button", { name: "Close signal details" }).click();
  snapshot = {
    ...snapshot,
    status: "partial",
    providers: snapshot.providers.map((p) =>
      p.id === "firms"
        ? { ...p, status: "unavailable", error: "missing_credentials" }
        : p,
    ),
  };
  await page
    .locator(".period-chips button", { hasText: "6H" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("button", { name: "1/2 sources current" })).toBeVisible();
  await page.getByRole("button", { name: "1/2 sources current" }).click();
  await expect(page.getByText("Refresh temporarily unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.route("**/api/signals?*", (route) => route.abort());
  await page
    .locator(".period-chips button", { hasText: "7D" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("button", { name: "0/2 sources current" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
