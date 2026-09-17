import { createHash } from "node:crypto";
import { latLngToCell } from "h3-js";
import { z } from "zod";
import { cellGeography } from "../../signals/geography";
import type { NormalizedBatch, Observation } from "../contract";
const snapshotSchema = z.object({
  time: z.number().int().positive(),
  states: z.array(z.array(z.unknown())).nullable(),
});
// Offline normalization only. Do not activate operational API collection without
// a written OpenSky agreement. No aircraft identifier survives aggregation.
export function normalizeOpenSkySnapshot(
  data: unknown,
  fetchedAt: string,
): NormalizedBatch {
  const snapshot = snapshotSchema.parse(data);
  if (
    !Number.isFinite(Date.parse(fetchedAt)) ||
    snapshot.time * 1000 > Date.parse(fetchedAt) ||
    Date.parse(fetchedAt) - snapshot.time * 1000 > 120000
  )
    throw new Error("Stale or future aviation snapshot");
  if (!snapshot.states?.length)
    throw new Error(
      "Empty aviation snapshot does not establish zero aircraft activity",
    );
  const aircraft = new Map<string, { cell: string; time: number }>();
  let rejected = 0;
  for (const state of snapshot.states) {
    const [id, , , positionTime, , longitude, latitude, , grounded] = state;
    if (
      grounded === true ||
      latitude === null ||
      longitude === null ||
      positionTime === null
    )
      continue;
    if (
      typeof id !== "string" ||
      !/^[a-f0-9]{6}$/i.test(id) ||
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180 ||
      typeof positionTime !== "number" ||
      !Number.isFinite(positionTime) ||
      grounded !== false
    ) {
      rejected++;
      continue;
    }
    if (snapshot.time - positionTime > 15 || positionTime > snapshot.time)
      continue;
    const previous = aircraft.get(id.toLowerCase());
    if (!previous || positionTime > previous.time)
      aircraft.set(id.toLowerCase(), {
        cell: latLngToCell(latitude, longitude, 2),
        time: positionTime,
      });
  }
  const cells = new Map<string, number>();
  for (const aircraftState of aircraft.values())
    cells.set(aircraftState.cell, (cells.get(aircraftState.cell) ?? 0) + 1);
  const timestamp = new Date(snapshot.time * 1000).toISOString();
  const observations: Observation[] = [...cells.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cellId, value]) => {
      const location = cellGeography(cellId);
      const upstreamId = `${cellId}:${snapshot.time}`;
      return {
        id: `opensky:${createHash("sha256").update(upstreamId).digest("hex")}`,
        upstreamId,
        provider: "opensky",
        type: "aviation",
        timestamp,
        sourceUpdatedAt: fetchedAt,
        latitude: location.latitude,
        longitude: location.longitude,
        value,
        cellId,
        quality: 0.5,
        sourceUrl: "https://opensky-network.org/",
        properties: {
          metric: "observed_airborne_aircraft_snapshot",
          country: location.country,
          geographicScope: "h3",
          sampleSize: value,
          globalSampleSize: aircraft.size,
          coverage: "receiver-coverage-unknown",
          snapshotSeconds: 1,
          maxPositionAgeSeconds: 15,
          absentCellsAreUnknown: true,
        },
        active: true,
      };
    });
  if (!observations.length) throw new Error("No usable airborne observations");
  return {
    observations,
    received: snapshot.states.length,
    rejected,
    sourceAsOf: timestamp,
    coverageStart: new Date((snapshot.time - 1) * 1000).toISOString(),
    coverageEnd: timestamp,
  };
}
