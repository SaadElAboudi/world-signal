import test from "node:test";
import assert from "node:assert/strict";
import { providerWideAnomaly } from "../src/signals/provider-wide-guard";

test("provider-wide IODA shifts suppress new country alerts", () => {
  const result = providerWideAnomaly({ assessedCountries: 30, anomalousCountries: 10 });
  assert.equal(result.suppressed, true);
  assert.equal(result.affectedFraction, 1 / 3);
});

test("a small number of country deviations remains eligible for review", () => {
  assert.equal(providerWideAnomaly({ assessedCountries: 30, anomalousCountries: 4 }).suppressed, false);
  assert.equal(providerWideAnomaly({ assessedCountries: 8, anomalousCountries: 8 }).suppressed, false);
});
