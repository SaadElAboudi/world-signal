import "../scripts/env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../scripts/migrate";
import { closePool, getPool } from "../src/database/client";
import {
  getPersistedInvestigation,
  listInvestigationHistory,
  saveInvestigation,
} from "../src/database/investigations";
import type { Investigation } from "../src/context/investigation";

const liveUrl = process.env.DATABASE_URL;
let testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl && liveUrl) {
  const url = new URL(liveUrl);
  if (["127.0.0.1", "localhost"].includes(url.hostname)) {
    url.pathname = "/world_signal_test";
    testUrl = url.toString();
  }
}
if (!testUrl || !new URL(testUrl).pathname.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must name a dedicated database ending in _test");
}
process.env.DATABASE_URL = testUrl;
process.env.WORLD_SIGNAL_MODE = "live";

const base: Investigation = {
  schemaVersion: 1,
  id: "investigation:signal-context-db",
  eventId: "signal-context-db",
  createdAt: "2026-09-22T10:00:00.000Z",
  window: { start: "2026-09-22T09:00:00.000Z", end: "2026-09-22T10:00:00.000Z" },
  location: { country: "France", region: "Normandy", latitude: 49.18, longitude: -0.37 },
  status: "no_explanation_found_yet",
  retrievalStatus: "complete",
  providers: [{ providerId: "fixture", status: "ok", evidenceCount: 0 }],
  evidence: [],
  explanationConfidence: { score: 0, level: "none", rationale: "No evidence." },
  corroborationStatus: "none",
  timeline: [{ timestamp: "2026-09-22T09:00:00.000Z", kind: "signal", label: "earthquake anomaly detected", signalId: "signal-context-db" }],
  unknowns: ["Causality has not been established."],
};

before(async () => {
  await migrate();
  await getPool().query("TRUNCATE context_investigation_history, context_investigations RESTART IDENTITY");
});

after(async () => {
  await closePool();
});

test("fresh investigations are reusable while expired investigations are not", async () => {
  const now = new Date("2026-09-22T10:05:00.000Z");
  await saveInvestigation("signal", base, { now, ttlMs: 10 * 60_000 });
  assert.equal((await getPersistedInvestigation("signal", base.eventId, { now }))?.eventId, base.eventId);
  assert.equal(
    await getPersistedInvestigation("signal", base.eventId, { now: new Date("2026-09-22T10:16:00.000Z") }),
    null,
  );
  assert.equal(
    (await getPersistedInvestigation("signal", base.eventId, { allowStale: true, now: new Date("2026-09-22T10:16:00.000Z") }))?.eventId,
    base.eventId,
  );
});

test("refresh preserves the previous investigation in history", async () => {
  const updated: Investigation = {
    ...base,
    createdAt: "2026-09-22T10:20:00.000Z",
    status: "context_found",
    corroborationStatus: "official_report_found",
    explanationConfidence: { score: 0.78, level: "moderate", rationale: "Official context found." },
  };
  await saveInvestigation("signal", updated, { now: new Date("2026-09-22T10:20:00.000Z") });
  const history = await listInvestigationHistory("signal", base.eventId);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.investigation.status, "no_explanation_found_yet");
  const current = await getPersistedInvestigation("signal", base.eventId, { allowStale: true });
  assert.equal(current?.corroborationStatus, "official_report_found");
});
