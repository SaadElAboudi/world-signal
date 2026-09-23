import { getPool } from "../database/client";
import { getStorageBudgetState } from "../database/resource-governor";
import { storageProfileForPressure } from "../database/storage-profile";
import { resolveMissingProviderEvents, upsertWorldEvents } from "../database/world-events";
import type { EventSeverity, WorldEvent } from "../events/types";
import {
  EntsoeActualLoadProvider,
  ENTSOE_REGIONS,
  type PowerLoadObservation,
} from "../providers/entsoe";
import { getConfig } from "./config";
import { log } from "./log";
import { collectionGuard } from "./resource-budget";

function severityForReduction(reduction: number): EventSeverity | null {
  if (reduction >= 0.5) return "significant";
  if (reduction >= 0.35) return "elevated";
  if (reduction >= 0.2) return "notable";
  return null;
}

function isWeekend(date: Date) {
  return date.getUTCDay() === 0 || date.getUTCDay() === 6;
}

async function storageRetentionDays() {
  const storage = await getStorageBudgetState();
  const config = getConfig();
  const profile = storageProfileForPressure(storage.pressure, {
    firmsRawRetentionHours: config.firmsRawRetentionHours,
    firmsRawSamplesPerCellHour: config.firmsRawSamplesPerHour,
  });
  return { days: profile.observationDays, storage };
}

async function storeLoads(observations: PowerLoadObservation[], now: Date, retentionDays: number) {
  const pool = getPool();
  for (const observation of observations) {
    await pool.query(
      `INSERT INTO power_load_hourly(provider,region_id,bucket_hour,load_mw,source_updated_at)
       VALUES('entsoe',$1,date_trunc('hour',$2::timestamptz),$3,$2)
       ON CONFLICT(provider,region_id,bucket_hour) DO UPDATE SET
         load_mw=EXCLUDED.load_mw,
         source_updated_at=GREATEST(power_load_hourly.source_updated_at,EXCLUDED.source_updated_at)`,
      [observation.region.id, observation.timestamp, observation.loadMw],
    );
  }
  await pool.query(
    "DELETE FROM power_load_hourly WHERE bucket_hour < $1::timestamptz-($2*interval '1 day')",
    [now, retentionDays],
  );
}

async function eventForObservation(observation: PowerLoadObservation): Promise<WorldEvent | null> {
  const timestamp = new Date(observation.timestamp);
  const history = await getPool().query(
    `SELECT load_mw
     FROM power_load_hourly
     WHERE provider='entsoe'
       AND region_id=$1
       AND bucket_hour < date_trunc('hour',$2::timestamptz)
       AND extract(hour from bucket_hour)=extract(hour from $2::timestamptz)
       AND ((extract(isodow from bucket_hour) IN (6,7)) = $3)
     ORDER BY bucket_hour DESC
     LIMIT 14`,
    [observation.region.id, observation.timestamp, isWeekend(timestamp)],
  );
  const samples = history.rows.map((row) => Number(row.load_mw)).filter(Number.isFinite);
  if (samples.length < 7) return null;
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  if (mean < 100) return null;
  const reduction = 1 - observation.loadMw / mean;
  const severity = severityForReduction(reduction);
  if (!severity) return null;
  const pct = Math.round(reduction * 100);
  const id = `entsoe:${observation.region.id}:load-drop`;
  return {
    schemaVersion: 1,
    id,
    category: "infrastructure",
    type: "power_grid_anomaly",
    title: `Power-system load anomaly · ${observation.region.name} −${pct}%`,
    description: `ENTSO-E actual system load is ${pct}% below a compact same-hour weekday/weekend reference (${samples.length} historical samples). This is a grid-load anomaly sentinel, not confirmation of a customer electricity outage or its cause.`,
    status: "active",
    severity,
    confidence: Math.min(0.72, 0.48 + samples.length * 0.015),
    startedAt: observation.timestamp,
    updatedAt: observation.timestamp,
    endedAt: null,
    location: {
      latitude: observation.region.latitude,
      longitude: observation.region.longitude,
      geometryType: "point",
    },
    magnitude: {
      value: Number((-reduction * 100).toFixed(1)),
      unit: "% vs matched load reference",
      description: `${observation.loadMw.toFixed(0)} MW current vs ${mean.toFixed(0)} MW matched reference`,
    },
    source: {
      provider: "entsoe",
      name: "ENTSO-E Transparency Platform",
      url: "https://transparency.entsoe.eu/",
      upstreamId: id,
    },
    secondarySources: [],
    properties: {
      observedLoadMw: Number(observation.loadMw.toFixed(1)),
      referenceLoadMw: Number(mean.toFixed(1)),
      reductionPercent: Number((reduction * 100).toFixed(1)),
      referenceSamples: samples.length,
      referenceMatch: "utc-hour+weekday-weekend",
      customerOutageConfirmed: false,
      coverage: "selected-european-bidding-zones-v1",
    },
  };
}

export async function refreshPowerGrid(now = new Date()) {
  if (process.env.ENTSOE_ENABLED !== "true")
    return { status: "disabled" as const, regions: 0, events: 0 };
  const token = process.env.ENTSOE_SECURITY_TOKEN;
  if (!token)
    return { status: "unavailable" as const, regions: 0, events: 0, reason: "missing_token" as const };

  const guard = await collectionGuard("entsoe", ENTSOE_REGIONS.length, { storageSensitive: true, now });
  if (!guard.allowed)
    return { status: "budget_limited" as const, regions: 0, events: 0, reason: guard.reason };

  const provider = new EntsoeActualLoadProvider({
    token,
    endpoint: process.env.ENTSOE_ENDPOINT || undefined,
  });
  const result = await provider.fetchLoads(now);
  if (!result.observations.length)
    return { status: "unavailable" as const, regions: 0, events: 0, failedRegions: result.failedRegions };

  const retention = await storageRetentionDays();
  await storeLoads(result.observations, now, retention.days);
  const events = (await Promise.all(result.observations.map(eventForObservation))).filter(
    (event): event is WorldEvent => event !== null,
  );
  await upsertWorldEvents(events, now);
  if (result.failedRegions.length === 0)
    await resolveMissingProviderEvents("entsoe", events.map((event) => event.id), now);

  log("power.refresh.completed", {
    regions: result.observations.length,
    failedRegions: result.failedRegions.length,
    events: events.length,
    retentionDays: retention.days,
    storagePressure: retention.storage.pressure,
  });
  return {
    status: result.failedRegions.length ? ("partial" as const) : ("success" as const),
    regions: result.observations.length,
    events: events.length,
    failedRegions: result.failedRegions,
  };
}
