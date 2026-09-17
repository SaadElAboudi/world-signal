import type { PoolClient } from "pg";
import { storeFireHistory, sampleRecentFireObservations } from "./fire-history";
import type { NormalizedBatch } from "../providers/contract";
/** One transaction plus a staging table gives atomic snapshots, bulk upserts and safe retractions. */
export async function storeObservations(
  client: PoolClient,
  provider: string,
  batch: NormalizedBatch,
  retentionHours = 0,
  samplesPerHour = 0,
) {
  await client.query("BEGIN");
  try {
    const compact = provider === "firms" && retentionHours > 0;
    if (compact) await storeFireHistory(client, batch);
    const cutoff = new Date(
      Date.parse(batch.sourceAsOf) - retentionHours * 3600000,
    ).toISOString();
    const retained = compact
      ? sampleRecentFireObservations(batch.observations, cutoff, samplesPerHour)
      : batch.observations;
    await client.query(
      "CREATE TEMP TABLE incoming_observations (LIKE observations INCLUDING DEFAULTS) ON COMMIT DROP",
    );
    for (let start = 0; start < retained.length; start += 1500) {
      const rows = retained.slice(start, start + 1500).map((o) => ({
        id: o.id,
        provider: o.provider,
        upstream_id: o.upstreamId,
        type: o.type,
        latitude: o.latitude,
        longitude: o.longitude,
        occurred_at: o.timestamp,
        source_updated_at: o.sourceUpdatedAt,
        value: o.value,
        cell_id: o.cellId,
        quality: o.quality,
        properties: o.properties,
        source_url: o.sourceUrl,
        active: o.active,
      }));
      await client.query(
        `INSERT INTO incoming_observations(id,provider,upstream_id,type,latitude,longitude,occurred_at,source_updated_at,value,cell_id,quality,properties,source_url,active)
        SELECT id,provider,upstream_id,type,latitude,longitude,occurred_at,source_updated_at,value,cell_id,quality,properties,source_url,active FROM jsonb_to_recordset($1::jsonb) AS x(id text,provider text,upstream_id text,type text,latitude float8,longitude float8,occurred_at timestamptz,source_updated_at timestamptz,value float8,cell_id text,quality float8,properties jsonb,source_url text,active boolean)`,
        [JSON.stringify(rows)],
      );
    }
    await client.query(
      "CREATE UNIQUE INDEX incoming_id ON incoming_observations(id)",
    );
    const result = await client.query(`WITH upserts AS (
      INSERT INTO observations SELECT * FROM incoming_observations
      ON CONFLICT(provider,upstream_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,occurred_at=EXCLUDED.occurred_at,source_updated_at=EXCLUDED.source_updated_at,value=EXCLUDED.value,cell_id=EXCLUDED.cell_id,quality=EXCLUDED.quality,properties=EXCLUDED.properties,source_url=EXCLUDED.source_url,active=EXCLUDED.active,ingested_at=now()
      WHERE EXCLUDED.source_updated_at >= observations.source_updated_at AND
      ROW(observations.latitude,observations.longitude,observations.occurred_at,observations.value,observations.cell_id,observations.quality,observations.properties,observations.active)
      IS DISTINCT FROM ROW(EXCLUDED.latitude,EXCLUDED.longitude,EXCLUDED.occurred_at,EXCLUDED.value,EXCLUDED.cell_id,EXCLUDED.quality,EXCLUDED.properties,EXCLUDED.active)
      RETURNING (xmax=0) AS inserted)
      SELECT count(*) FILTER(WHERE inserted)::int AS inserted, count(*) FILTER(WHERE NOT inserted)::int AS updated FROM upserts`);
    // Only a validated, complete feed can retract previously ingested observations.
    const retracted = await client.query(
      `UPDATE observations o SET active=false,ingested_at=now(),source_updated_at=$4 WHERE provider=$1 AND active AND occurred_at >= $2 AND occurred_at <= $3 AND source_updated_at <= $4 AND NOT EXISTS(SELECT 1 FROM incoming_observations i WHERE i.id=o.id)`,
      [provider, batch.coverageStart, batch.coverageEnd, batch.sourceAsOf],
    );
    if (compact) {
      await client.query(
        "DELETE FROM observations WHERE provider='firms' AND occurred_at<$1",
        [cutoff],
      );
      await client.query(
        "DELETE FROM fire_hourly WHERE hour_end<$1::timestamptz-interval '35 days'",
        [batch.sourceAsOf],
      );
      await client.query(
        "DELETE FROM fire_hour_coverage WHERE hour_end<$1::timestamptz-interval '35 days'",
        [batch.sourceAsOf],
      );
    }
    await client.query("COMMIT");
    return {
      inserted: result.rows[0].inserted as number,
      updated: (result.rows[0].updated as number) + (retracted.rowCount ?? 0),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
