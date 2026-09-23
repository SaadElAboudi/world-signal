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
  await expect(page.locator(".multi-signal-card")).toHaveCount(1);
  await page.locator(".multi-signal-card").click();
  await expect(page.locator(".event-timeline li")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Détails de l’événement multi-signaux" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Événements signalés" }).click();
  await expect(page.locator(".signal-card")).toHaveCount(1);
  await page.locator(".signal-card").click();
  await expect(
    page.getByRole("region", { name: "Détails de l’événement" }),
  ).toBeVisible();
  await expect(page.locator(".big-measure")).toContainText("85");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".earth-loading")).toHaveCount(0, {
    timeout: 60000,
  });
  await page.screenshot({
    path: `test-results/${info.project.name}-fr-events.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Risques naturels" }).click();
  await expect(
    page.getByText("Aucun événement dans cette période"),
  ).toBeVisible();
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
