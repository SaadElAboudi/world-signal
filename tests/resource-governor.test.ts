import test from "node:test";
import assert from "node:assert/strict";
import { storageProfileForPressure } from "../src/database/storage-profile";

test("storage pressure contracts retention before free-tier exhaustion", () => {
  const configured = {
    firmsRawRetentionHours: 48,
    firmsRawSamplesPerCellHour: 5,
  };
  const normal = storageProfileForPressure("normal", configured);
  const watch = storageProfileForPressure("watch", configured);
  const conserve = storageProfileForPressure("conserve", configured);
  const critical = storageProfileForPressure("critical", configured);

  assert.equal(normal.observationDays, 35);
  assert.equal(watch.observationDays, 28);
  assert.equal(conserve.observationDays, 21);
  assert.equal(critical.observationDays, 14);
  assert.equal(critical.firmsRawRetentionHours, 12);
  assert.equal(critical.firmsRawSamplesPerCellHour, 1);
  assert(critical.eventHistoryDays < normal.eventHistoryDays);
});

test("adaptive profile never increases configured raw sampling", () => {
  const configured = {
    firmsRawRetentionHours: 24,
    firmsRawSamplesPerCellHour: 1,
  };
  const critical = storageProfileForPressure("critical", configured);
  assert.equal(critical.firmsRawRetentionHours, 12);
  assert.equal(critical.firmsRawSamplesPerCellHour, 1);
});

test("unlimited raw sampling becomes bounded under storage pressure", () => {
  for (const pressure of ["watch", "conserve", "critical"] as const) {
    const profile = storageProfileForPressure(pressure, {
      firmsRawRetentionHours: 48,
      firmsRawSamplesPerCellHour: 0,
    });
    assert(profile.firmsRawSamplesPerCellHour > 0);
    assert(profile.firmsRawSamplesPerCellHour <= 3);
  }
});
