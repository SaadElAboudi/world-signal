import { operationalProviders, providerMetadata } from "../providers/registry";
import { getPool } from "../database/client";
import { getConfig } from "./config";
import type { ProviderHealth } from "../core/types";
export interface RunHealthRow {
  provider: string;
  status: string;
  finished_at: Date | null;
  error_code: string | null;
  success_at: Date | null;
  source_as_of: Date | null;
  latest_observation_at: Date | null;
  analysed_at?: Date | null;
  analysis_error?: string | null;
  records_received: number;
  records_inserted: number;
  records_updated: number;
}
export function classifyHealth(
  row: RunHealthRow | undefined,
  id: string,
  now = new Date(),
): ProviderHealth {
  const config = getConfig();
  const base: ProviderHealth = {
    id,
    name: providerMetadata(id)?.name ?? id,
    system: providerMetadata(id)?.system,
    cadenceMinutes:
      id === "usgs"
        ? config.usgsIntervalMinutes
        : id === "firms"
          ? config.firmsIntervalMinutes
          : id === "ioda"
            ? config.internetIntervalMinutes
            : config.aviationIntervalMinutes,
    status: "unavailable",
    lastSuccessAt: row?.success_at?.toISOString() ?? null,
    lastAnalysisAt: row?.analysed_at?.toISOString() ?? null,
    analysisError: row?.analysis_error ?? null,
    sourceAsOf: row?.source_as_of?.toISOString() ?? null,
    latestObservationAt: row?.latest_observation_at?.toISOString() ?? null,
    recordsReceived: row?.records_received ?? 0,
    recordsInserted: row?.records_inserted ?? 0,
    recordsUpdated: row?.records_updated ?? 0,
    error: row?.error_code ?? null,
  };
  if (id === "firms" && config.firmsTransport === "api" && !config.firmsKey)
    return { ...base, error: "missing_credentials" };
  if (!row?.success_at || !row.source_as_of) return base;
  const budget =
    (id === "usgs"
      ? config.usgsStaleMinutes
      : id === "firms"
        ? config.firmsStaleMinutes
        : id === "ioda"
          ? config.internetStaleMinutes
          : config.aviationStaleMinutes) * 60000;
  const age =
    now.getTime() -
    Math.min(row.success_at.getTime(), row.source_as_of.getTime());
  const observationAge = row.latest_observation_at
    ? now.getTime() - row.latest_observation_at.getTime()
    : Infinity;
  if (
    age > budget ||
    (id === "firms" &&
      observationAge > config.firmsObservationMaxAgeHours * 3600000)
  )
    return { ...base, status: "delayed" };
  if (row.status === "failed" || row.status === "unavailable")
    return { ...base, status: "error" };
  return { ...base, status: "healthy" };
}
export async function getProviderHealth(
  now = new Date(),
): Promise<ProviderHealth[]> {
  const result = await getPool()
    .query(`SELECT latest.provider, latest.status, latest.finished_at, latest.error_code,
    success.finished_at AS success_at, success.analysed_at, success.analysis_error, success.source_as_of, success.latest_observation_at, latest.records_received,latest.records_inserted,latest.records_updated
    FROM (SELECT DISTINCT ON(provider) * FROM provider_runs ORDER BY provider,started_at DESC) latest
    LEFT JOIN LATERAL (SELECT * FROM provider_runs r WHERE r.provider=latest.provider AND r.status='success' ORDER BY finished_at DESC LIMIT 1) success ON true`);
  const states = operationalProviders.map(({ id }) =>
    classifyHealth(
      result.rows.find((r) => r.provider === id),
      id,
      now,
    ),
  );
  const scopes = await getPool().query(
    "SELECT provider,count(*)::int AS configured,count(*) FILTER(WHERE ok)::int AS available,count(*) FILTER(WHERE ok AND latest_observation_at>$1::timestamptz-interval '3 hours')::int AS fresh FROM provider_scopes GROUP BY provider",
    [now],
  );
  const history = await getPool().query(
    "SELECT provider,extract(epoch FROM (max(occurred_at)-min(occurred_at)))/86400 AS days FROM observations WHERE provider IN ('ioda','adsblol') AND active GROUP BY provider",
  );
  for (const state of states) {
    const scope = scopes.rows.find((s) => s.provider === state.id);
    if (scope) {
      state.scopes = {
        configured: scope.configured,
        available: scope.available,
        fresh: scope.fresh,
      };
      if (scope.available < scope.configured && state.status === "healthy") {
        state.status = "delayed";
        state.error = "partial_scope_coverage";
      }
    }
    if (state.id === "ioda" || state.id === "adsblol") {
      state.historyDays = Number(
        history.rows.find((r) => r.provider === state.id)?.days ?? 0,
      );
      state.analysisState =
        state.historyDays >= 10 ? "ready" : "collecting_history";
    }
  }
  return states;
}
