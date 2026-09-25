import { test, expect } from "@playwright/test";
import { demoSnapshot } from "../../src/providers/demo";
import type { SignalSnapshot } from "../../src/core/types";
import type { WorldEvent } from "../../src/events/types";

test("French, grouped evidence and reported events remain understandable and usable", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const asOf = new Date().toISOString();
  const signals = [demoSnapshot.signals[0], demoSnapshot.signals[2]].map(
    (s, i) => ({
      ...s,
      id: `ui-fixture-${i}`,
      provenance: "observed" as const,
      country: "Japan",
      timestamp: asOf,
      startedAt: asOf,
      sourceAsOf: asOf,
    }),
  );
  const snapshot: SignalSnapshot = {
    ...demoSnapshot,
    mode: "live",
    status: "partial",
    asOf,
    signals,
    correlations: [
      {
        id: "ui-fixture-correlation",
        geographicScope: {
          kind: "country",
          country: "Japan",
          latitude: 37,
          longitude: 139,
        },
        startedAt: asOf,
        updatedAt: asOf,
        windowEnd: asOf,
        windowHours: 6,
        signalIds: signals.map((s) => s.id),
        signalTypes: ["earthquake", "internet"],
        providerIds: ["usgs", "ioda"],
        correlationStrength: 0.8,
        confidence: 0.55,
        severity: "significant",
        status: "active",
        provenance: "observed",
        methodology: "Browser fixture",
        relationship: "Browser fixture",
      },
    ],
  };
  const event: WorldEvent = {
    schemaVersion: 1,
    id: "ui-fixture-weather",
    type: "high_wind",
    category: "climate",
    title: "Paris · vent fort",
    description: "Browser fixture only",
    status: "active",
    severity: "elevated",
    confidence: 0.7,
    startedAt: asOf,
    updatedAt: asOf,
    endedAt: null,
    location: { latitude: 48.8, longitude: 2.3, geometryType: "point" },
    magnitude: { value: 85, unit: "km/h", description: "Peak wind" },
    source: {
      provider: "fixture",
      name: "Weather fixture",
      url: "https://example.test/weather",
      upstreamId: "weather",
    },
    secondarySources: [],
    properties: {},
  };
  await page.route("**/api/signals?*", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/events?*", (route) =>
    route.fulfill({ json: { events: [event] } }),
  );
  await page.goto("/?mode=live&lang=fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { name: "Comprendre ce qui change." })).toBeVisible();
  if (info.project.name !== "mobile") {
    await page.locator(".map-legend .legend-earthquake").click();
    await expect(page.locator(".world-feed-card")).toHaveCount(2);
    await page.locator(".map-legend .legend-all").click();
  }
  await expect(page.locator(".world-feed-card.correlation")).toHaveCount(1);
  await page.locator(".world-feed-card.correlation").click();
  await expect(page.locator(".event-timeline li")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Détails de l’événement multi-signaux" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fermer les détails de l’événement" }).click();
  await expect(page.locator(".world-feed-card")).toHaveCount(4);
  await page
    .locator(".world-feed-card")
    .filter({ hasText: "Paris · vent fort" })
    .click();
  await expect(
    page.getByRole("region", { name: "Détails de l’événement" }),
  ).toBeVisible();
  await expect(page.locator(".big-measure")).toContainText("85");
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Fermer l’événement" }).click();
    await expect(page.getByRole("tab", { name: "Fil" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Carte" })).toBeVisible();
  } else {
    await expect(page.locator("canvas")).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".earth-loading")).toHaveCount(0, {
      timeout: 60000,
    });
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (info.project.name !== "mobile") {
    await page.getByRole("button", { name: "Fermer l’événement" }).click();
  }
  await page.getByRole("button", { name: "Océans et environnement" }).click();
  await expect(page.locator(".world-feed-card")).toHaveCount(0);
  await expect(page.locator(".empty-state")).toContainText("Aucun événement");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
