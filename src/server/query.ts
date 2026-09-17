import type { Severity, SignalType, WorldSignal } from "../core/types";
import { DataError } from "./log";
export interface SignalQuery {
  types: SignalType[];
  severity?: Severity;
  since: string;
  until: string;
  bbox?: [number, number, number, number];
  query?: string;
  country?: string;
  limit: number;
  offset: number;
  includeResolved: boolean;
}
export function parseSignalQuery(
  params: URLSearchParams,
  anchor: string,
  mode: "demo" | "live",
): SignalQuery {
  const types = params.has("type")
    ? params.get("type")!.split(",")
    : ["earthquake", "wildfire", "internet", "aviation"];
  if (
    types.some(
      (t) => !["earthquake", "wildfire", "internet", "aviation"].includes(t),
    )
  )
    throw new DataError("invalid_type");
  const severity = params.get("severity") ?? undefined;
  if (severity && !["notable", "elevated", "significant"].includes(severity))
    throw new DataError("invalid_severity");
  const end = params.get("until") ?? anchor;
  const start =
    params.get("since") ??
    new Date(
      Date.parse(anchor) - (mode === "demo" ? 30 : 1) * 86400000,
    ).toISOString();
  if (
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end)) ||
    Date.parse(start) > Date.parse(end) ||
    Date.parse(end) - Date.parse(start) > 31 * 86400000 ||
    Date.parse(end) > Date.parse(anchor) + 300000
  )
    throw new DataError("invalid_time_range");
  let bbox: SignalQuery["bbox"];
  if (params.has("bbox")) {
    const parts = params.get("bbox")!.split(",");
    const numbers = parts.map(Number);
    if (
      parts.length !== 4 ||
      parts.some((p) => !p.trim()) ||
      numbers.some((n) => !Number.isFinite(n)) ||
      Math.abs(numbers[0]) > 180 ||
      Math.abs(numbers[2]) > 180 ||
      Math.abs(numbers[1]) > 90 ||
      Math.abs(numbers[3]) > 90 ||
      numbers[1] > numbers[3]
    )
      throw new DataError("invalid_bbox");
    bbox = numbers as SignalQuery["bbox"];
  }
  const limit = Number(params.get("limit") ?? 250),
    offset = Number(params.get("offset") ?? 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10000
  )
    throw new DataError("invalid_pagination");
  const query = params.get("q")?.trim(),
    country = params.get("country")?.trim();
  if ((query?.length ?? 0) > 120 || (country?.length ?? 0) > 100)
    throw new DataError("query_too_long");
  return {
    types: types as SignalType[],
    severity: severity as Severity | undefined,
    since: new Date(start).toISOString(),
    until: new Date(end).toISOString(),
    bbox,
    query,
    country,
    limit,
    offset,
    includeResolved: params.get("includeResolved") === "true",
  };
}
export function matchesQuery(signal: WorldSignal, query: SignalQuery) {
  const bbox = query.bbox;
  return (
    query.types.includes(signal.type) &&
    (!query.severity || signal.severity === query.severity) &&
    signal.timestamp >= query.since &&
    signal.timestamp <= query.until &&
    (!query.country || signal.country === query.country) &&
    (!query.query ||
      `${signal.country} ${signal.region} ${signal.title} ${signal.type}`
        .toLowerCase()
        .includes(query.query.toLowerCase())) &&
    (!bbox ||
      (signal.latitude >= bbox[1] &&
        signal.latitude <= bbox[3] &&
        (bbox[0] <= bbox[2]
          ? signal.longitude >= bbox[0] && signal.longitude <= bbox[2]
          : signal.longitude >= bbox[0] || signal.longitude <= bbox[2]))) &&
    (query.includeResolved || signal.status !== "resolved")
  );
}
export function querySql(query: SignalQuery) {
  const values: unknown[] = [query.types, query.since, query.until];
  const conditions = [
    "type=ANY($1::text[])",
    "observed_at >= $2",
    "observed_at <= $3",
  ];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query.severity) conditions.push(`severity=${add(query.severity)}`);
  if (!query.includeResolved) conditions.push("resolved_at IS NULL");
  if (query.country)
    conditions.push(`payload->>'country'=${add(query.country)}`);
  if (query.query) {
    const p = add(`%${query.query.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(
      `concat_ws(' ',payload->>'country',payload->>'region',payload->>'title',type) ILIKE ${p}`,
    );
  }
  if (query.bbox) {
    const [w, s, e, n] = query.bbox;
    const west = add(w),
      south = add(s),
      east = add(e),
      north = add(n);
    conditions.push(
      `latitude BETWEEN ${south} AND ${north}`,
      w <= e
        ? `longitude BETWEEN ${west} AND ${east}`
        : `(longitude>=${west} OR longitude<=${east})`,
    );
  }
  return { where: conditions.join(" AND "), values };
}
