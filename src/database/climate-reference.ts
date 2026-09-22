import { getPool } from "./client";
import type { TemperatureExtremeKind, TemperatureReference } from "../climate/reference";

export interface StoredTemperatureReference extends TemperatureReference {
  cellId: string;
  kind: TemperatureExtremeKind;
  monthDay: string;
  referenceStart: string;
  referenceEnd: string;
}

export async function getTemperatureReference(
  cellId: string,
  kind: TemperatureExtremeKind,
  monthDay: string,
): Promise<StoredTemperatureReference | null> {
  const result = await getPool().query(
    `SELECT cell_id,extreme_kind,month_day,mean_c,stddev_c,p10_c,p90_c,sample_count,reference_start,reference_end
     FROM climate_references WHERE cell_id=$1 AND extreme_kind=$2 AND month_day=$3`,
    [cellId, kind, monthDay],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    cellId: row.cell_id,
    kind: row.extreme_kind,
    monthDay: row.month_day,
    meanC: Number(row.mean_c),
    stddevC: Number(row.stddev_c),
    p10C: Number(row.p10_c),
    p90C: Number(row.p90_c),
    sampleCount: Number(row.sample_count),
    referenceStart: row.reference_start.toISOString().slice(0, 10),
    referenceEnd: row.reference_end.toISOString().slice(0, 10),
  };
}

export async function saveTemperatureReference(
  reference: StoredTemperatureReference,
) {
  await getPool().query(
    `INSERT INTO climate_references(cell_id,extreme_kind,month_day,mean_c,stddev_c,p10_c,p90_c,sample_count,reference_start,reference_end)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT(cell_id,extreme_kind,month_day) DO UPDATE SET
       mean_c=EXCLUDED.mean_c,stddev_c=EXCLUDED.stddev_c,p10_c=EXCLUDED.p10_c,p90_c=EXCLUDED.p90_c,
       sample_count=EXCLUDED.sample_count,reference_start=EXCLUDED.reference_start,reference_end=EXCLUDED.reference_end,computed_at=now()`,
    [
      reference.cellId,
      reference.kind,
      reference.monthDay,
      reference.meanC,
      reference.stddevC,
      reference.p10C,
      reference.p90C,
      reference.sampleCount,
      reference.referenceStart,
      reference.referenceEnd,
    ],
  );
}
