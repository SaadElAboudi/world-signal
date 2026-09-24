import { operationalProviders } from "../providers/registry";
import { demoCorrelations } from "../providers/demo-correlations";
import { getPool } from "../database/client";
import { demoSnapshot } from "../providers/demo";
import type {
  SignalSnapshot,
  WorldSignal,
  ProviderHealth,
} from "../core/types";
import { getProviderHealth } from "./health";
import {
  parseSignalQuery,
  matchesQuery,
  querySql,
  type SignalQuery,
} from "./query";
import { getConfig } from "./config";
import { DataError, log, errorCode } from "./log";
const cache = new Map<string, { at: number; snapshot: SignalSnapshot }>();
export function clearSnapshotCache() {
  cache.clear();
}
export function aggregateHealth(
  providers: ProviderHealth[],
): SignalSnapshot["status"] {
  const healthy = providers.filter((p) => p.status === "healthy").length;
  return healthy === providers.length
    ? "live"
    : healthy > 0
      ? "partial"
      : providers.some((p) => p.lastSuccessAt)
        ? "delayed"
        : "unavailable";
}
export function modeFromParams(params: URLSearchParams) {
  const mode = params.get("mode") ?? getConfig().mode;
  if (mode !== "demo" && mode !== "live") throw new DataError("invalid_mode");
  return mode;
}
export async function getSnapshot(
  params = new URLSearchParams(),
  now = new Date(),
): Promise<SignalSnapshot> {
  const mode = modeFromParams(params);
  const asOf = mode === "demo" ? demoSnapshot.asOf : now.toISOString();
  const query = parseSignalQuery(params, asOf, mode);
  if (mode === "demo") {
    const filtered = demoSnapshot.signals.filter((s) => matchesQuery(s, query));
    return {
      ...demoSnapshot,
      status: "demo",
      correlations: demoCorrelations.filter((e) =>
        e.signalIds.every((id) => filtered.some((s) => s.id === id)),
      ),
      signals: filtered.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
      truncated: filtered.length > query.offset + query.limit,
    };
  }
  const key = params.toString();
  const cached = cache.get(key);
  if (cached && now.getTime() - cached.at < 15000) return cached.snapshot;
  try {
    const providers = (await getProviderHealth(now)).map((provider) =>
      provider.status === "healthy" &&
      (!provider.lastAnalysisAt ||
        provider.analysisError ||
        now.getTime() - Date.parse(provider.lastAnalysisAt) >
          getConfig().analysisStaleMinutes * 60000)
        ? {
            ...provider,
            status: "delayed" as const,
            error:
              provider.analysisError ??
              (provider.lastAnalysisAt
                ? "analysis_delayed"
                : "analysis_pending"),
          }
        : provider,
    );
    const { where, values } = querySql(query);
    const result = await getPool().query(
      `SELECT payload FROM signals WHERE ${where} ORDER BY CASE severity WHEN 'significant' THEN 0 WHEN 'elevated' THEN 1 ELSE 2 END,observed_at DESC,id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.limit, query.offset],
    );
    const total = Number(
      (
        await getPool().query(
          `SELECT count(*) FROM signals WHERE ${where}`,
          values,
        )
      ).rows[0].count,
    );
    const signalIds = new Set(result.rows.map((r) => r.payload.id));
    const correlationsResult = await getPool().query(
      "SELECT payload FROM correlated_events WHERE window_end >= $1 AND window_end <= $2 AND ($3 OR status='active') ORDER BY updated_at DESC LIMIT 100",
      [query.since, query.until, query.includeResolved],
    );
    const correlationRun = await getPool().query(
      "SELECT max(computed_at) AS as_of FROM correlation_runs",
    );
    const snapshot: SignalSnapshot = {
      correlations: correlationsResult.rows
        .map((r) => r.payload)
        .filter((e) => e.signalIds.every((id: string) => signalIds.has(id))),
      correlationAsOf: correlationRun.rows[0]?.as_of?.toISOString() ?? null,

      mode: "live",
      collectionCadenceMinutes: Math.max(
        getConfig().collectionCadenceMinutes,
        ...providers.map((p) => p.cadenceMinutes ?? 0),
      ),
      asOf: now.toISOString(),
      providers,
      status: aggregateHealth(providers),
      signals: result.rows.map((r) => r.payload as WorldSignal),
      total,
      truncated: total > query.offset + query.limit,
    };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now.getTime(), snapshot });
    return snapshot;
  } catch (error) {
    log("snapshot.unavailable", { code: errorCode(error) });
    return {
      mode: "live",
      collectionCadenceMinutes: getConfig().collectionCadenceMinutes,
      asOf: now.toISOString(),
      status: "unavailable",
      signals: [],
      total: 0,
      providers: operationalProviders.map((p) => ({
        id: p.id,
        name: p.name,
        system: p.system,
        status: "unavailable" as const,
        error: "database_unavailable",
      })),
    };
  }
}
export async function getSignal(id: string, mode: "demo" | "live") {
  if (mode === "demo")
    return demoSnapshot.signals.find((s) => s.id === id) ?? null;
  const result = await getPool().query(
    "SELECT payload FROM signals WHERE id=$1",
    [id],
  );
  return (result.rows[0]?.payload as WorldSignal | undefined) ?? null;
}
export function sqlForTests(query: SignalQuery) {
  return querySql(query);
}
