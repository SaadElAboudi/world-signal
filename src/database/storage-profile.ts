import type { StoragePressure } from "./resource-governor";

export interface StorageProfile {
  eventHistoryDays: number;
  resolvedEventDays: number;
  observationDays: number;
  providerRunDays: number;
  fireAggregateDays: number;
  firmsRawRetentionHours: number;
  firmsRawSamplesPerCellHour: number;
}

export function storageProfileForPressure(
  pressure: StoragePressure,
  configured: {
    firmsRawRetentionHours: number;
    firmsRawSamplesPerCellHour: number;
  },
): StorageProfile {
  const rawHours = configured.firmsRawRetentionHours || 48;
  const rawSamples = configured.firmsRawSamplesPerCellHour || Infinity;
  if (pressure === "critical")
    return {
      eventHistoryDays: 7,
      resolvedEventDays: 14,
      observationDays: 14,
      providerRunDays: 14,
      fireAggregateDays: 14,
      firmsRawRetentionHours: Math.min(rawHours, 12),
      firmsRawSamplesPerCellHour: Math.min(rawSamples, 1),
    };
  if (pressure === "conserve")
    return {
      eventHistoryDays: 14,
      resolvedEventDays: 21,
      observationDays: 21,
      providerRunDays: 21,
      fireAggregateDays: 21,
      firmsRawRetentionHours: Math.min(rawHours, 24),
      firmsRawSamplesPerCellHour: Math.min(rawSamples, 2),
    };
  if (pressure === "watch")
    return {
      eventHistoryDays: 21,
      resolvedEventDays: 28,
      observationDays: 28,
      providerRunDays: 30,
      fireAggregateDays: 28,
      firmsRawRetentionHours: Math.min(rawHours, 36),
      firmsRawSamplesPerCellHour: Math.min(rawSamples, 3),
    };
  return {
    eventHistoryDays: 30,
    resolvedEventDays: 35,
    observationDays: 35,
    providerRunDays: 40,
    fireAggregateDays: 35,
    firmsRawRetentionHours: configured.firmsRawRetentionHours,
    firmsRawSamplesPerCellHour: configured.firmsRawSamplesPerCellHour,
  };
}
