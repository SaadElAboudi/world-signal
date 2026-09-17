import type { PoolClient } from "pg";
import type { NormalizedBatch } from "../providers/contract";
const HOUR = 3600000;
interface Hour {
  hour_end: string;
  cell_id: string;
  detections: number;
  quality_sum: number;
  frp_total: number | null;
  frp_count: number;
  first_at: string;
  last_at: string;
  high: number;
  nominal: number;
}
/** Aggregate the full validated batch before discarding any old raw observations.
 * Full hours replace, rather than add to, previous counts. Zero hours have coverage rows.
 * The timestamp minus 1 ms preserves the raw query's (start,end] interval convention.
 */
export function aggregateFireHours(batch: NormalizedBatch) {
  const firstEnd =
    Math.ceil(Date.parse(batch.coverageStart) / HOUR) * HOUR + HOUR;
  const lastEnd = Math.floor(Date.parse(batch.coverageEnd) / HOUR) * HOUR;
  const hours: string[] = [];
  for (let t = firstEnd; t <= lastEnd; t += HOUR)
    hours.push(new Date(t).toISOString());
  const grouped = new Map<string, Hour>();
  for (const o of batch.observations) {
    if (!o.active || o.quality < 0.5) continue;
    const end = Math.floor((Date.parse(o.timestamp) - 1) / HOUR) * HOUR + HOUR;
    if (end < firstEnd || end > lastEnd) continue;
    const key = `${end}:${o.cellId}`;
    let row = grouped.get(key);
    if (!row) {
      row = {
        hour_end: new Date(end).toISOString(),
        cell_id: o.cellId,
        detections: 0,
        quality_sum: 0,
        frp_total: null,
        frp_count: 0,
        first_at: o.timestamp,
        last_at: o.timestamp,
        high: 0,
        nominal: 0,
      };
      grouped.set(key, row);
    }
    row.detections++;
    row.quality_sum += o.quality;
    if (o.value !== null) {
      row.frp_total = (row.frp_total ?? 0) + o.value;
      row.frp_count++;
    }
    if (o.timestamp < row.first_at) row.first_at = o.timestamp;
    if (o.timestamp > row.last_at) row.last_at = o.timestamp;
    if (o.quality >= 0.9) row.high++;
    else row.nominal++;
  }
  return { hours, rows: [...grouped.values()] };
}
/** Caller holds the provider lock and transaction, shared with raw-observation storage. */
export async function storeFireHistory(
  client: PoolClient,
  batch: NormalizedBatch,
) {
  const { hours, rows } = aggregateFireHours(batch);
  const accepted = await client.query(
    `INSERT INTO fire_hour_coverage(hour_end,source_as_of)
    SELECT unnest($1::timestamptz[]),$2::timestamptz
    ON CONFLICT(hour_end) DO UPDATE SET source_as_of=EXCLUDED.source_as_of
    WHERE EXCLUDED.source_as_of>=fire_hour_coverage.source_as_of RETURNING hour_end`,
    [hours, batch.sourceAsOf],
  );
  const allowed = new Set(accepted.rows.map((r) => r.hour_end.toISOString()));
  await client.query(
    "DELETE FROM fire_hourly WHERE hour_end=ANY($1::timestamptz[])",
    [[...allowed]],
  );
  const incoming = rows.filter((r) => allowed.has(r.hour_end));
  for (let i = 0; i < incoming.length; i += 1500) {
    await client.query(
      `INSERT INTO fire_hourly
      SELECT hour_end,cell_id,detections,quality_sum,frp_total,frp_count,first_at,last_at,high,nominal,$2::timestamptz
      FROM jsonb_to_recordset($1::jsonb) AS x(hour_end timestamptz,cell_id text,detections integer,quality_sum float8,frp_total float8,frp_count integer,first_at timestamptz,last_at timestamptz,high integer,nominal integer)`,
      [JSON.stringify(incoming.slice(i, i + 1500)), batch.sourceAsOf],
    );
  }
}
export async function fireAggregates(client: PoolClient, end: number) {
  return client.query(
    `WITH grouped AS (
    SELECT cell_id,floor(extract(epoch FROM ($1::timestamptz-hour_end))/86400)::int AS bucket,
    sum(detections)::int AS count,(sum(quality_sum)/sum(detections))::float8 AS mean_quality,
    sum(frp_total)::float8 AS frp_total,sum(frp_count)::int AS frp_count,min(first_at) AS first_at,max(last_at) AS last_at,
    sum(high)::int AS high,sum(nominal)::int AS nominal,0::int AS low
    FROM fire_hourly WHERE hour_end<=$1 AND hour_end>$1::timestamptz-interval '31 days' GROUP BY cell_id,bucket
  ), ranked AS (
    SELECT id,cell_id,occurred_at,row_number() OVER(PARTITION BY cell_id ORDER BY occurred_at DESC,id) AS rn
    FROM observations WHERE provider='firms' AND active AND quality>=0.5 AND occurred_at<=$1 AND occurred_at>$1::timestamptz-interval '24 hours'
  ), samples AS (SELECT cell_id,array_agg(id ORDER BY occurred_at DESC,id) AS ids FROM ranked WHERE rn<=20 GROUP BY cell_id)
  SELECT g.*,s.ids FROM grouped g LEFT JOIN samples s ON s.cell_id=g.cell_id AND g.bucket=0`,
    [new Date(end)],
  );
}

/** Raw evidence sampling never changes the complete hourly counts used for statistics. */
export function sampleRecentFireObservations(
  observations: NormalizedBatch["observations"],
  cutoff: string,
  limit: number,
) {
  const recent = observations.filter((o) => o.timestamp >= cutoff);
  if (!limit) return recent;
  recent.sort(
    (a, b) =>
      Number(b.quality >= 0.5) - Number(a.quality >= 0.5) ||
      b.timestamp.localeCompare(a.timestamp) ||
      a.id.localeCompare(b.id),
  );
  const counts = new Map<string, number>();
  return recent.filter((o) => {
    const key = `${o.cellId}:${Math.floor((Date.parse(o.timestamp) - 1) / HOUR)}`;
    const count = counts.get(key) ?? 0;
    if (count >= limit) return false;
    counts.set(key, count + 1);
    return true;
  });
}
