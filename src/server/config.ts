function numberEnv(name: string, fallback: number, min = 0, max = 1000000) {
  const value =
    process.env[name] === undefined || process.env[name] === ""
      ? fallback
      : Number(process.env[name]);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`Invalid configuration: ${name}`);
  return value;
}
function thresholds(
  name: string,
  fallback: [number, number, number],
): [number, number, number] {
  const values = process.env[name]?.split(",").map(Number) ?? fallback;
  if (
    values.length !== 3 ||
    values.some(
      (v, i) => !Number.isFinite(v) || v <= 0 || (i > 0 && v <= values[i - 1]),
    )
  )
    throw new Error(`Invalid configuration: ${name}`);
  return values as [number, number, number];
}
export function getConfig() {
  const mode = process.env.WORLD_SIGNAL_MODE || "demo";
  if (mode !== "demo" && mode !== "live")
    throw new Error("WORLD_SIGNAL_MODE must be demo or live");
  const firmsTransport = process.env.FIRMS_TRANSPORT || "public";
  if (!["public", "api"].includes(firmsTransport))
    throw new Error("FIRMS_TRANSPORT must be public or api");
  return {
    mode: mode as "demo" | "live",
    databaseUrl: process.env.DATABASE_URL,
    databaseSslCa: process.env.DATABASE_SSL_CA,
    databasePoolMax: numberEnv("DATABASE_POOL_MAX", 5, 2, 20),
    firmsRawSamplesPerHour: numberEnv(
      "FIRMS_RAW_SAMPLES_PER_CELL_HOUR",
      0,
      0,
      100,
    ),
    firmsRawRetentionHours:
      process.env.FIRMS_RAW_RETENTION_HOURS === undefined ||
      process.env.FIRMS_RAW_RETENTION_HOURS === "0"
        ? 0
        : numberEnv("FIRMS_RAW_RETENTION_HOURS", 48, 48, 168),
    analysisStaleMinutes: numberEnv("ANALYSIS_STALE_MINUTES", 15, 5, 1440),
    collectionCadenceMinutes: numberEnv(
      "COLLECTION_CADENCE_MINUTES",
      5,
      5,
      1440,
    ),
    firmsTransport: firmsTransport as "public" | "api",
    firmsKey: process.env.NASA_FIRMS_API_KEY,
    usgsIntervalMinutes: numberEnv("USGS_INTERVAL_MINUTES", 5, 5),
    firmsIntervalMinutes: numberEnv("FIRMS_INTERVAL_MINUTES", 60, 30),
    usgsStaleMinutes: numberEnv("USGS_STALE_MINUTES", 20, 5),
    firmsStaleMinutes: numberEnv("FIRMS_STALE_MINUTES", 240, 30),
    firmsObservationMaxAgeHours: numberEnv(
      "FIRMS_OBSERVATION_MAX_AGE_HOURS",
      12,
      3,
    ),
    firmsSettlementHours: numberEnv("FIRMS_SETTLEMENT_HOURS", 3, 0, 24),
    fireMinWindows: numberEnv("FIRE_MIN_BASELINE_WINDOWS", 5, 5, 30),
    fireMinHistory: numberEnv("FIRE_MIN_BASELINE_DETECTIONS", 20, 10),
    fireMinCurrent: numberEnv("FIRE_MIN_CURRENT_DETECTIONS", 20, 5),
    fireThresholds: thresholds("FIRE_RATIO_THRESHOLDS", [2, 3, 4]),
    quakeSeverityMagnitudes: thresholds(
      "QUAKE_SEVERITY_MAGNITUDES",
      [4.5, 5.5, 6],
    ),
    quakeSeveritySignificance: thresholds(
      "QUAKE_SEVERITY_SIGNIFICANCE",
      [600, 750, 1000],
    ),
    quakeMinMagnitude: numberEnv("QUAKE_MIN_MAGNITUDE", 5, 0, 10),
    quakeShallowMagnitude: numberEnv("QUAKE_SHALLOW_MIN_MAGNITUDE", 4.5, 0, 10),
    quakeShallowDepth: numberEnv("QUAKE_SHALLOW_MAX_DEPTH_KM", 70, 0, 1000),
    quakeMinSignificance: numberEnv("QUAKE_MIN_SIGNIFICANCE", 600),
    quakeClusterMagnitude: numberEnv("QUAKE_CLUSTER_MIN_MAGNITUDE", 2.5, 0, 10),
    quakeClusterMinCount: numberEnv("QUAKE_CLUSTER_MIN_COUNT", 5, 3),
    quakeClusterMinWindows: numberEnv(
      "QUAKE_CLUSTER_MIN_BASELINE_WINDOWS",
      14,
      14,
      120,
    ),
    quakeThresholds: thresholds("QUAKE_CLUSTER_Z_THRESHOLDS", [2, 3, 4]),
  };
}
export type AppConfig = ReturnType<typeof getConfig>;
